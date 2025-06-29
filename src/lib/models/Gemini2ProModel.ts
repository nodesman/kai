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
import { InteractivePromptReviewer } from "../UserInteraction/InteractivePromptReviewer"; // NEW Import
import { Message } from "../models/Conversation"; // Correct path
import chalk from 'chalk';
// --- Conditional Imports ---
// Removed: inquirer
// Removed: fs
// Removed: path
// Removed: os
// Removed: execSync
// --- End Conditional Imports ---

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
    private promptReviewer: InteractivePromptReviewer; // NEW Property

    constructor(config: Config) {
        super(config);
        if (!config.gemini?.api_key) {
            throw new Error("Gemini API key is missing in the configuration.");
        }
        this.genAI = new GoogleGenerativeAI(config.gemini.api_key);
        // --- Use Pro model name from config (guaranteed by Config.ts) ---
        this.modelName = config.gemini.model_name;
        console.log(chalk.yellow(`Initializing Gemini Model instance with: ${this.modelName}`));
        try {
            this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        } catch (error) {
            console.error(chalk.red(`Failed to initialize model ${this.modelName}:`), error);
            throw new Error(`Failed to get generative model for ${this.modelName}. Check model name and API key validity.`);
        }

        this.maxRetries = config.gemini.generation_max_retries ?? 3;
        this.retryBaseDelay = config.gemini.generation_retry_base_delay_ms ?? 2000;
        // NEW: Initialize the InteractivePromptReviewer
        this.promptReviewer = new InteractivePromptReviewer(config);
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
        try {
            const generationConfig = {
                maxOutputTokens: this.config.gemini.max_output_tokens || 8192,
                // Add other generation config if needed
            };
            const historyForChat = geminiMessages.slice(0, -1);
            const lastMessageToSend = geminiMessages[geminiMessages.length - 1];
            if (!lastMessageToSend || lastMessageToSend.role !== "user") throw new Error("Internal Error: Last message must be user.");

            const initialPromptText = lastMessageToSend.parts.map((part) => part.text).join('');
            let finalPromptText = initialPromptText;

            // --- START: Conditional Interactive Prompt Edit/Confirmation ---
            if (this.config.gemini.interactive_prompt_review) { // Check config flag
                try {
                    const reviewedPrompt = await this.promptReviewer.reviewPrompt(initialPromptText);
                    if (reviewedPrompt === null) {
                        throw new Error('User cancelled prompt submission.'); // Propagate cancellation
                    }
                    finalPromptText = reviewedPrompt;
                } catch (cancellationError: any) {
                    // Re-throw if it's a cancellation or unrecoverable editor error from the reviewer
                    throw cancellationError;
                }
            } else {
                // Log that the interactive review is disabled
                console.log(chalk.dim('Interactive prompt review DISABLED. Sending prompt directly...'));
            }
            // --- END: Conditional Interactive Prompt Edit/Confirmation ---

            const chatSession = this.model.startChat({
                history: historyForChat as Content[],
                generationConfig,
            });

            console.log(chalk.blue(`Sending final prompt to ${this.modelName}... (${finalPromptText.length} characters)`));
            const result = await chatSession.sendMessage(finalPromptText); // Use the final prompt text

            if (result.response && typeof result.response.text === 'function') {
                const responseText = result.response.text();
                console.log(chalk.blue(`Received response from ${this.modelName}. (${responseText.length} characters)`));
                return responseText;
            } else {
                const finishReason = result.response?.candidates?.[0]?.finishReason;
                const safetyRatings = result.response?.candidates?.[0]?.safetyRatings;
                let blockReason = finishReason ? `Finish Reason: ${finishReason}` : 'Reason unknown.';
                if (finishReason === FinishReason.SAFETY && safetyRatings) {
                    blockReason += ` Safety Ratings: ${JSON.stringify(safetyRatings)}`;
                }
                throw new Error(`AI response from ${this.modelName} missing content. ${blockReason}`);
            }
        } catch (error) {
            // Handle user cancellation specifically, don't pass to generic handleError
            if (error instanceof Error && error.message.startsWith('User cancelled prompt submission')) {
                console.log(chalk.yellow(error.message)); // Log the cancellation message
                return ''; // Return empty string or handle as appropriate for a cancelled operation
            }
            // Otherwise, let the standard error handler deal with it
            this.handleError(error, this.modelName);
            return ''; // Unreachable if handleError throws, but satisfies TS
        }
    }

    // --- generateContent Method (No changes needed here) ---
    async generateContent(request: GenerateContentRequest): Promise<GenerateContentResult> {
        // ... (Implementation remains the same as previous version) ...
        let attempts = 0;
        while (attempts <= this.maxRetries) {
            try {
                console.log(chalk.blue(`Calling generateContent on ${this.modelName} (Attempt ${attempts + 1}/${this.maxRetries + 1})...`));
                const finalRequest: GenerateContentRequest = {
                    ...request,
                    generationConfig: {
                        maxOutputTokens: this.config.gemini.max_output_tokens || 8192,
                        ...(request.generationConfig || {}),
                    },
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
                 if (error.stack && !isBlockError) {
                    console.error(chalk.gray(error.stack));
                 }

                 if (shouldRetry) {
                     attempts++;
                    const delay = this.retryBaseDelay * Math.pow(2, attempts - 1) + Math.random() * 1000; // Add jitter
                    console.log(chalk.yellow(`Retrying in ${(delay / 1000).toFixed(1)}s... (${attempts}/${this.maxRetries})`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                 } else {
                    console.error(chalk.red(`generateContent failed after ${attempts + 1} attempts for ${this.modelName}. Non-retryable error or max retries reached.`));
                    this.handleError(error, this.modelName);
                     throw error;
                 }
                // --- End Retry Logic ---
            }
        }
        throw new Error(`generateContent failed definitively after ${this.maxRetries + 1} attempts for ${this.modelName}.`);
    }
    // --- *** END generateContent METHOD *** ---

    // --- convertToGeminiConversation (Unchanged) ---
    convertToGeminiConversation(messages: Message[]): GeminiChatHistory {
        // ... (Implementation remains the same) ...
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
         if (history.length > 0 && history[history.length - 1].role !== 'user') {
            console.warn(chalk.yellow("Conversation history ended with a model message. This might lead to unexpected behavior in some chat scenarios. Consider ensuring the final message for the prompt is from the 'user'."));
        }
        return history;
    }

    // --- handleError (Unchanged structure, accepts modelName) ---
     handleError(error: any, modelName: string): void {
        // ... (Implementation remains the same) ...
         let errorMessage = `An error occurred while making the AI API request (using ${modelName}).`;
         let errorCode = (error as any)?.code || 'UNKNOWN';

         if (error instanceof Error && (error.message.includes('FETCH_ERROR') || error.message.includes('fetch failed') || error.name === 'FetchError' || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].some(code => error.message.includes(code)))) {
             errorMessage = `\n⚠️ Network Error (using ${modelName}): ${error.message}`;
             errorCode = errorCode === 'UNKNOWN' ? 'NETWORK_ERROR' : errorCode;
         }
         else if (error instanceof Error && (error.message?.includes('[GoogleGenerativeAI Error]') || error.message?.includes('Google API Error'))) {
             errorMessage += `\n⚠️ Google AI Error: ${error.message}`;
             if (error.message.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
             else if (error.message.includes('429') || error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('rate limit')) errorCode = 'RATE_LIMIT';
             else if (error.message.includes('500') || error.message.includes('503') || error.message.toLowerCase().includes('internal server error') || error.message.toLowerCase().includes('backend error')) errorCode = 'SERVER_OVERLOADED';
             else if (error.message.includes('SAFETY') || errorCode === FinishReason.SAFETY) errorCode = 'SAFETY_BLOCK';
             else if (error.message.includes('recitation') || errorCode === FinishReason.RECITATION) errorCode = 'RECITATION_BLOCK';
             else if (error.message.includes('400 Bad Request') && error.message.toLowerCase().includes('model') && error.message.toLowerCase().includes('not found')) errorCode = 'INVALID_MODEL';
             else if (error.message.includes('400 Bad Request')) errorCode = 'BAD_REQUEST';
         }
         else if (error.status && typeof error.status === 'number') {
             errorMessage += `\n❌ HTTP Status: ${error.status}`;
             errorMessage += `\n📌 AI Error Details: ${error.message || JSON.stringify(error)}`;
             errorCode = `API_ERROR_${error.status}`;
             if (error.status === 400 && error.message?.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
             if (error.status === 400 && error.message?.toLowerCase().includes('model') && error.message.toLowerCase().includes('not found')) errorCode = 'INVALID_MODEL';
             if (error.status === 400) errorCode = errorCode.startsWith('API_ERROR') ? 'BAD_REQUEST' : errorCode;
             if (error.status === 401 || error.status === 403) errorCode = 'AUTH_ERROR';
             if (error.status === 429) errorCode = 'RATE_LIMIT';
             if (error.status === 500 || error.status === 503) errorCode = 'SERVER_OVERLOADED';
         }
         else if (error.code && typeof error.code === 'string' && errorCode === 'UNKNOWN') {
             errorMessage += `\n⚠️ System/Code Error: ${error.code} - ${error.message}`;
             errorCode = error.code;
         }
         else if (error.message && errorCode === 'UNKNOWN') {
             errorMessage += `\n⚠️ General Error: ${error.message}`;
             if (error.message.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
             if (error.message.includes('429') || error.message.toLowerCase().includes('rate limit') || error.message.toLowerCase().includes('quota')) errorCode = 'RATE_LIMIT';
             if (error.message.includes('500') || error.message.includes('503') || error.message.toLowerCase().includes('server error')) errorCode = 'SERVER_OVERLOADED';
             if (error.message.toLowerCase().includes('safety')) errorCode = 'SAFETY_BLOCK';
             if (error.message.toLowerCase().includes('model') && error.message.toLowerCase().includes('not found')) errorCode = 'INVALID_MODEL';
         }
         else if (errorCode === 'UNKNOWN'){
             errorMessage += `\n❓ An unexpected error occurred with ${modelName}. ${JSON.stringify(error)}`;
         }

         console.error(chalk.red(errorMessage));
         if (error.stack && !errorMessage.includes('Google AI Error') && !errorMessage.includes('HTTP Status')) {
             console.error(chalk.gray(error.stack));
         }

         const originalMsg = (error instanceof Error) ? error.message : JSON.stringify(error);
         const finalErrorMessage = `AI API Error (${errorCode}) using ${modelName}: ${originalMsg || 'Details in console log.'}`
         const codedError = new Error(finalErrorMessage);
         (codedError as any).code = errorCode;
         (codedError as any).originalError = error;
         throw codedError;
     }
}

export default Gemini2ProModel;