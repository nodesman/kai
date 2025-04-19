// src/lib/models/Gemini2ProModel.ts
import BaseModel from "./BaseModel";
import {
    GoogleGenerativeAI,
    Content,
    GenerativeModel,
    GenerateContentRequest, // Import request type
    GenerateContentResult,  // Import result type
    Part,                   // Import Part type
    FinishReason            // Import FinishReason
} from "@google/generative-ai";
import { Config } from "../Config";
import { Message } from "../models/Conversation"; // Correct path
import chalk from 'chalk';
import inquirer from 'inquirer'; // <-- Import inquirer
import fs from 'fs';             // <-- Import fs for file operations
import path from 'path';         // <-- Import path for file paths
import os from 'os';             // <-- Import os for temp directory
import { execSync } from 'child_process'; // <-- Import execSync to run commands

// Types for internal conversion (unchanged)
interface GeminiMessagePart { text: string; }
interface GeminiMessage { role: "user" | "model"; parts: GeminiMessagePart[]; }
type GeminiChatHistory = GeminiMessage[];

class Gemini2ProModel extends BaseModel {
    genAI: GoogleGenerativeAI;
    modelName: string; // Store the specific model name for this instance
    model: GenerativeModel; // The specific model instance
    private maxRetries: number;
    private retryBaseDelay: number;

    constructor(config: Config) {
        super(config);
        if (!config.gemini?.api_key) {
            throw new Error("Gemini API key is missing in the configuration.");
        }
        this.genAI = new GoogleGenerativeAI(config.gemini.api_key);
        // Ensure model_name is prioritized, fallback to default
        this.modelName = config.gemini.model_name || "gemini-2.5-pro-preview-03-25"; // Stick to the specific 2.5 Pro preview
        console.log(chalk.yellow(`Initializing Gemini Model instance with: ${this.modelName}`));
        try {
            this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        } catch (error) {
            console.error(chalk.red(`Failed to initialize model ${this.modelName}:`), error);
            throw new Error(`Failed to get generative model for ${this.modelName}. Check model name and API key validity.`);
        }

        this.maxRetries = config.gemini.generation_max_retries ?? 3;
        this.retryBaseDelay = config.gemini.generation_retry_base_delay_ms ?? 2000;
    }

    // --- getResponseFromAI (for Chat - Unchanged) ---
    async getResponseFromAI(messages: Message[]): Promise<string> {
        if (!messages || messages.length === 0) {
            throw new Error("Cannot get AI response with empty message history.");
        }
        const geminiConversation: GeminiChatHistory = this.convertToGeminiConversation(messages);
        return this.queryGeminiChat(geminiConversation); // Use chat-specific method
    }

    // --- queryGeminiChat (Helper for getResponseFromAI - MODIFIED) ---
    async queryGeminiChat(geminiMessages: GeminiChatHistory): Promise<string> {
        let tempFilePath: string | null = null; // Keep track of temp file path

        try {
            const generationConfig = {
                maxOutputTokens: this.config.gemini.max_output_tokens || 8192,
                // Add other generation config from this.config.gemini if needed
                // temperature: this.config.gemini.temperature,
                // topP: this.config.gemini.top_p,
                // topK: this.config.gemini.top_k,
            };
            const historyForChat = geminiMessages.slice(0, -1);
            const lastMessageToSend = geminiMessages[geminiMessages.length - 1];
            if (!lastMessageToSend || lastMessageToSend.role !== "user") throw new Error("Internal Error: Last message must be user.");

            let lastMessageText = lastMessageToSend.parts.map((part) => part.text).join(''); // Initial text

            // --- START: Interactive Prompt Edit/Confirmation ---
            console.log(chalk.magenta('Preparing prompt for review...'));

            // 1. Create a temporary file
            const tempDir = os.tmpdir();
            tempFilePath = path.join(tempDir, `gemini-prompt-${Date.now()}.txt`);
            fs.writeFileSync(tempFilePath, lastMessageText, 'utf8');
            console.log(chalk.grey(`Prompt saved to temporary file: ${tempFilePath}`));

            // 2. Open in Sublime Text (adjust command if needed for your OS/setup)
            //    Using '--wait' blocks the script until Sublime Text is closed.
            const sublimeCommand = `subl --wait "${tempFilePath}"`; // Common command for macOS/Linux if subl is in PATH
            // const sublimeCommand = `"C:\\Program Files\\Sublime Text\\subl.exe" --wait "${tempFilePath}"`; // Example for Windows default install

            try {
                console.log(chalk.yellow(`Opening prompt in Sublime Text. Please review/edit and close the editor to continue...`));
                execSync(sublimeCommand); // This will pause execution
                console.log(chalk.yellow('Sublime Text closed.'));

                // 3. Read back the potentially edited content
                lastMessageText = fs.readFileSync(tempFilePath, 'utf8');

            } catch (editError: any) {
                console.error(chalk.red(`Error opening or waiting for Sublime Text:`), editError.message);
                console.warn(chalk.yellow('Proceeding with the original prompt content.'));
                // Optional: Ask if user *still* wants to proceed even if editor failed
                const { proceedAnyway } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'proceedAnyway',
                        message: 'Sublime Text could not be opened/tracked. Continue with the original prompt?',
                        default: false,
                    },
                ]);
                if (!proceedAnyway) {
                    throw new Error('User cancelled prompt submission after editor failure.');
                }
                // Original lastMessageText will be used
            }

            // 4. Ask for confirmation using inquirer
            const { confirmSend } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmSend',
                    message: `Send the reviewed prompt (length: ${lastMessageText.length}) to ${this.modelName}?`,
                    default: true,
                },
            ]);

            // 5. Handle confirmation result
            if (!confirmSend) {
                console.log(chalk.red('User cancelled prompt submission.'));
                throw new Error('User cancelled prompt submission.'); // Abort the operation
            }
            console.log(chalk.green('User confirmed. Proceeding...'));
            // --- END: Interactive Prompt Edit/Confirmation ---

            // --- Original Logic Continues (using potentially edited lastMessageText) ---
            const chatSession = this.model.startChat({
                history: historyForChat as Content[],
                generationConfig,
                // systemInstruction: // Add system instruction if applicable
            });

            console.log(chalk.blue(`Sending final prompt to ${this.modelName}... (Length: ${lastMessageText.length})`));
            const result = await chatSession.sendMessage(lastMessageText); // Use the confirmed text

            if (result.response && typeof result.response.text === 'function') {
                const responseText = result.response.text();
                console.log(chalk.blue(`Received response from ${this.modelName}. (Length: ${responseText.length})`));
                return responseText;
            } else {
                const finishReason = result.response?.candidates?.[0]?.finishReason;
                const safetyRatings = result.response?.candidates?.[0]?.safetyRatings;
                let blockReason = finishReason ? `Finish Reason: ${finishReason}` : 'Reason unknown.';
                if (finishReason === FinishReason.SAFETY && safetyRatings) { // Use imported Enum
                    blockReason += ` Safety Ratings: ${JSON.stringify(safetyRatings)}`;
                }
                throw new Error(`AI response from ${this.modelName} missing content. ${blockReason}`);
            }
        } catch (error) {
            // Make sure handleError is called, but catch specific cancellation error
            if (error instanceof Error && error.message === 'User cancelled prompt submission.') {
                console.log(chalk.yellow('Operation cancelled by user before sending prompt.'));
                return ''; // Or throw the error if the caller should handle cancellation
            }
             if (error instanceof Error && error.message === 'User cancelled prompt submission after editor failure.') {
                 console.log(chalk.yellow('Operation cancelled by user after editor failure.'));
                 return ''; // Or throw
             }
            // Otherwise, let the standard error handler deal with it
            this.handleError(error, this.modelName);
            return ''; // Unreachable if handleError throws, but satisfies TS
        } finally {
            // --- Cleanup ---
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                    console.log(chalk.grey(`Temporary prompt file deleted: ${tempFilePath}`));
                } catch (cleanupError) {
                    console.error(chalk.red(`Failed to delete temporary file: ${tempFilePath}`), cleanupError);
                }
            }
            // --- End Cleanup ---
        }
    }


    // --- generateContent Method (Unchanged) ---
    async generateContent(request: GenerateContentRequest): Promise<GenerateContentResult> {
        let attempts = 0;
        while (attempts <= this.maxRetries) {
            try {
                console.log(chalk.blue(`Calling generateContent on ${this.modelName} (Attempt ${attempts + 1}/${this.maxRetries + 1})...`));
                const finalRequest: GenerateContentRequest = {
                    ...request,
                    generationConfig: {
                        maxOutputTokens: this.config.gemini.max_output_tokens || 8192,
                        ...(request.generationConfig || {}),
                         // temperature: this.config.gemini.temperature,
                         // topP: this.config.gemini.top_p,
                         // topK: this.config.gemini.top_k,
                    },
                    // safetySettings: request.safetySettings || [...default safety settings...],
                };

                const result = await this.model.generateContent(finalRequest);

                if (!result || !result.response) {
                    console.warn(chalk.yellow(`generateContent call to ${this.modelName} returned an empty result/response object.`));
                    throw new Error(`AI response from ${this.modelName} was unexpectedly empty.`);
                }

                const candidate = result.response.candidates?.[0];
                const finishReason = candidate?.finishReason;

                if (finishReason && finishReason !== FinishReason.STOP && finishReason !== FinishReason.MAX_TOKENS) {
                    console.warn(chalk.yellow(`Model ${this.modelName} finished with reason: ${finishReason}.`));
                    let reasonDetails = '';
                    if (finishReason === FinishReason.SAFETY) {
                        reasonDetails = ` Safety Ratings: ${JSON.stringify(candidate?.safetyRatings)}`;
                        console.warn(chalk.yellow(reasonDetails));
                    }
                    const blockError = new Error(`Model ${this.modelName} generation blocked. Reason: ${finishReason}.${reasonDetails}`);
                    (blockError as any).code = finishReason;
                    throw blockError;
                }

                const hasFunctionCall = !!candidate?.content?.parts?.some(p => p.functionCall);
                const hasText = !!candidate?.content?.parts?.some(p => p.text);

                if (!hasFunctionCall && !hasText && finishReason === FinishReason.STOP) {
                    console.warn(chalk.yellow(`Model ${this.modelName} finished normally but produced no text or function call.`));
                }

                return result;

            } catch (error: any) {
                // --- Retry Logic ---
                const isBlockError = error instanceof Error && error.message.startsWith('Model') && error.message.includes('generation blocked');
                 const assignedErrorCode = (error as any).code; // Code from block error or handleError

                 let isRetryable = false;
                 // Check codes attached by handleError OR standard retryable conditions
                 if (assignedErrorCode) {
                     isRetryable = ['RATE_LIMIT', 'SERVER_OVERLOADED', 'NETWORK_ERROR', 'NO_RESPONSE'].includes(assignedErrorCode);
                 } else if (error instanceof Error) {
                     // Fallback checks if code wasn't attached yet (e.g., network error before handleError)
                     isRetryable = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].some(code => error.message.includes(code)) ||
                                    error.message.includes('fetch failed') || error.message.includes('timeout');
                 }

                // Decide if we should retry based on the error type and code
                 const shouldRetry = !isBlockError && isRetryable && attempts < this.maxRetries;

                 console.error(chalk.red(`Error during generateContent (Attempt ${attempts + 1}) using ${this.modelName}:`), error.message);
                 if (error.stack && !isBlockError) { // Don't need stack for simple block errors
                    console.error(chalk.grey(error.stack));
                 }


                 if (shouldRetry) {
                     attempts++;
                    const delay = this.retryBaseDelay * Math.pow(2, attempts - 1) + Math.random() * 1000; // Add jitter
                    console.log(chalk.yellow(`Retrying in ${(delay / 1000).toFixed(1)}s... (${attempts}/${this.maxRetries})`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                 } else {
                    console.error(chalk.red(`generateContent failed after ${attempts + 1} attempts for ${this.modelName}. Non-retryable error or max retries reached.`));
                    // Ensure handleError formats and re-throws the final error
                    // It will attach a code if it wasn't already present (like from blockError)
                    this.handleError(error, this.modelName);
                    // This throw should technically be unreachable if handleError always throws
                     throw error;
                 }
                // --- End Retry Logic ---
            }
        }
        // Should only be reached if maxRetries is < 0, which is unlikely. Added for TS completeness.
        throw new Error(`generateContent failed definitively after ${this.maxRetries + 1} attempts for ${this.modelName}.`);
    }
    // --- *** END generateContent METHOD *** ---


    // --- convertToGeminiConversation (Unchanged) ---
    convertToGeminiConversation(messages: Message[]): GeminiChatHistory {
        const history: GeminiChatHistory = [];
        let lastRole: 'user' | 'model' | null = null;

        for (const msg of messages) {
            if (!msg.role || !msg.content || msg.role === 'system') continue;

            const currentRole = msg.role === 'assistant' ? 'model' : 'user';

            if (history.length > 0 && currentRole === lastRole) {
                history[history.length - 1].parts.push({ text: msg.content });
            } else {
                history.push({ role: currentRole, parts: [{ text: msg.content }] });
                lastRole = currentRole;
            }
        }
         // Ensure the very last message is from the user
         if (history.length > 0 && history[history.length - 1].role !== 'user') {
            console.warn(chalk.yellow("Conversation history ended with a model message. This might lead to unexpected behavior in some chat scenarios. Consider ensuring the final message for the prompt is from the 'user'."));
            // Depending on strictness, you might want to throw an error here or append a dummy user message
             // throw new Error("Internal Error: Conversation history must end with a user message for chat.");
        }
        return history;
    }

    // --- handleError (Unchanged structure, accepts modelName) ---
     handleError(error: any, modelName: string): void {
         let errorMessage = `An error occurred while making the AI API request (using ${modelName}).`;
         let errorCode = (error as any)?.code || 'UNKNOWN'; // Preserve code if already attached

         // Check specific error types first
         if (error instanceof Error && (error.message.includes('FETCH_ERROR') || error.message.includes('fetch failed') || error.name === 'FetchError' || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].some(code => error.message.includes(code)))) {
             errorMessage = `\n⚠️ Network Error (using ${modelName}): ${error.message}`;
             errorCode = errorCode === 'UNKNOWN' ? 'NETWORK_ERROR' : errorCode; // Don't overwrite specific network codes if present
         }
         // GoogleGenerativeAI specific error structure (e.g., content safety, API key)
         else if (error instanceof Error && (error.message?.includes('[GoogleGenerativeAI Error]') || error.message?.includes('Google API Error'))) {
             errorMessage += `\n⚠️ Google AI Error: ${error.message}`;
             // Extract details if possible (status, specific reasons)
             if (error.message.includes('API key not valid')) {
                 errorCode = 'INVALID_API_KEY';
             } else if (error.message.includes('429') || error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('rate limit')) {
                 errorCode = 'RATE_LIMIT';
            } else if (error.message.includes('500') || error.message.includes('503') || error.message.toLowerCase().includes('internal server error') || error.message.toLowerCase().includes('backend error')) {
                 errorCode = 'SERVER_OVERLOADED';
             } else if (error.message.includes('SAFETY') || errorCode === FinishReason.SAFETY) { // Check existing code too
                 errorCode = 'SAFETY_BLOCK';
             } else if (error.message.includes('recitation') || errorCode === FinishReason.RECITATION) {
                 errorCode = 'RECITATION_BLOCK';
             } else if (error.message.includes('400 Bad Request') && error.message.toLowerCase().includes('model') && error.message.toLowerCase().includes('not found')) {
                 errorCode = 'INVALID_MODEL';
            } else if (error.message.includes('400 Bad Request')) {
                errorCode = 'BAD_REQUEST'; // Generic 400
             }
             // Add more specific checks based on observed errors from the SDK
         }
        // HTTP error structure (often wrapped by the SDK error, but check just in case)
         else if (error.status && typeof error.status === 'number') {
             errorMessage += `\n❌ HTTP Status: ${error.status}`;
             errorMessage += `\n📌 AI Error Details: ${error.message || JSON.stringify(error)}`;
             errorCode = `API_ERROR_${error.status}`; // Keep original code if more specific
             if (error.status === 400 && error.message?.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
             if (error.status === 400 && error.message?.toLowerCase().includes('model') && error.message.toLowerCase().includes('not found')) errorCode = 'INVALID_MODEL';
             if (error.status === 400) errorCode = errorCode.startsWith('API_ERROR') ? 'BAD_REQUEST' : errorCode; // Prefer specific if already set
             if (error.status === 401 || error.status === 403) errorCode = 'AUTH_ERROR'; // Broader auth
             if (error.status === 429) errorCode = 'RATE_LIMIT';
             if (error.status === 500 || error.status === 503) errorCode = 'SERVER_OVERLOADED';
         }
         // Error object with a specific 'code' property (like NodeJS errors) but not already handled
         else if (error.code && typeof error.code === 'string' && errorCode === 'UNKNOWN') {
             errorMessage += `\n⚠️ System/Code Error: ${error.code} - ${error.message}`;
             errorCode = error.code; // Use the existing code
         }
         // General Error Message if no specific structure matched
         else if (error.message && errorCode === 'UNKNOWN') {
             errorMessage += `\n⚠️ General Error: ${error.message}`;
             // Try to infer code from message content if possible
             if (error.message.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
             if (error.message.includes('429') || error.message.toLowerCase().includes('rate limit') || error.message.toLowerCase().includes('quota')) errorCode = 'RATE_LIMIT';
             if (error.message.includes('500') || error.message.includes('503') || error.message.toLowerCase().includes('server error')) errorCode = 'SERVER_OVERLOADED';
             if (error.message.toLowerCase().includes('safety')) errorCode = 'SAFETY_BLOCK';
             if (error.message.toLowerCase().includes('model') && error.message.toLowerCase().includes('not found')) errorCode = 'INVALID_MODEL';
         }
         // Fallback for unknown error types
         else if (errorCode === 'UNKNOWN'){
             errorMessage += `\n❓ An unexpected error occurred with ${modelName}. ${JSON.stringify(error)}`;
         }

         console.error(chalk.red(errorMessage));
         // Add stack trace for non-API errors if available
         if (error.stack && !errorMessage.includes('Google AI Error') && !errorMessage.includes('HTTP Status')) {
             console.error(chalk.grey(error.stack));
         }

         // Create a new error object, attach the code, and throw it
         // Use original error message if more specific, otherwise use the formatted one
         const originalMsg = (error instanceof Error) ? error.message : JSON.stringify(error);
         const finalErrorMessage = `AI API Error (${errorCode}) using ${modelName}: ${originalMsg || 'Details in console log.'}`
         const codedError = new Error(finalErrorMessage);
         (codedError as any).code = errorCode; // Attach the determined code
         (codedError as any).originalError = error; // Attach original error if needed downstream
         throw codedError; // Throw the enhanced error
     }
}

export default Gemini2ProModel;