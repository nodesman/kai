// File: src/lib/models/Gemini2FlashModel.ts
import BaseModel from "./BaseModel";
import {
    GoogleGenerativeAI,
    Content, // Keep for chat history conversion
    GenerativeModel,
    GenerateContentRequest, // Import request type
    GenerateContentResult,  // Import result type
    Part,                  // Import Part type
    FinishReason           // Import FinishReason
} from "@google/generative-ai";
import { Config } from "../Config"; // Correct path if needed
import { Message } from "../models/Conversation"; // Correct path
import chalk from 'chalk';

// Types for internal conversion (unchanged)
interface GeminiMessagePart { text: string; }
interface GeminiMessage { role: "user" | "model"; parts: GeminiMessagePart[]; }
type GeminiChatHistory = GeminiMessage[];

class Gemini2FlashModel extends BaseModel {
    genAI: GoogleGenerativeAI;
    modelName: string; // Store the specific model name for this instance
    model: GenerativeModel; // The specific model instance
    // --- ADD RETRY CONFIG ---
    private maxRetries: number;
    private retryBaseDelay: number;
    // --- END RETRY CONFIG ---

    constructor(config: Config) {
        super(config);
        if (!config.gemini?.api_key) {
            throw new Error("Gemini API key is missing in the configuration.");
        }
        this.genAI = new GoogleGenerativeAI(config.gemini.api_key);
        const selectedModelName = config.gemini.subsequent_chat_model_name;

        // If a non-Gemini model (like Claude) is selected elsewhere, the config might
        // be temporarily inconsistent. This check prevents a crash.
        if (!selectedModelName.toLowerCase().startsWith('gemini')) {
            this.modelName = selectedModelName; // Store it for logging/debugging
            console.log(chalk.dim(`Skipping Google AI initialization for non-Gemini model: ${selectedModelName}`));
            this.model = {} as GenerativeModel; // Assign a dummy object to prevent downstream 'undefined' errors
            this.maxRetries = config.gemini.generation_max_retries ?? 3;
            this.retryBaseDelay = config.gemini.generation_retry_base_delay_ms ?? 2000;
            return; // Exit constructor early
        }

        this.modelName = selectedModelName;
        console.log(chalk.yellow(`Initializing Gemini Flash Model instance with: ${this.modelName}`));
        try {
            this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        } catch (error) {
            console.error(chalk.red(`Failed to initialize model ${this.modelName}:`), error);
            throw new Error(`Failed to get generative model for ${this.modelName}. Check model name and API key validity.`);
        }

        // --- STORE RETRY CONFIG ---
        this.maxRetries = config.gemini.generation_max_retries ?? 3; // Use specific generation retries
        this.retryBaseDelay = config.gemini.generation_retry_base_delay_ms ?? 2000; // Use specific generation delay
        // --- END STORE RETRY CONFIG ---
    }

    // --- getResponseFromAI (for Chat - Unchanged) ---
    async getResponseFromAI(messages: Message[]): Promise<string> {
        if (!messages || messages.length === 0) {
            throw new Error("Cannot get AI response with empty message history.");
        }
        const geminiConversation: GeminiChatHistory = this.convertToGeminiConversation(messages);
        return this.queryGeminiChat(geminiConversation); // Use chat-specific method
    }

    // --- queryGeminiChat (Helper for getResponseFromAI - Unchanged) ---
    async queryGeminiChat(geminiMessages: GeminiChatHistory): Promise<string> {
        try {
            const generationConfig = {
                maxOutputTokens: this.config.gemini.max_output_tokens || 8192,
                // Flash might have different optimal settings, adjust if needed
            };
            const historyForChat = geminiMessages.slice(0, -1);
            const lastMessageToSend = geminiMessages[geminiMessages.length - 1];
            if (!lastMessageToSend || lastMessageToSend.role !== "user") throw new Error("Internal Error: Last message must be user.");

            const chatSession = this.model.startChat({
                history: historyForChat as Content[],
                generationConfig,
            });
            const lastMessageText = lastMessageToSend.parts.map((part) => part.text).join('');
            console.log(chalk.blue(`Sending prompt to ${this.modelName}... (last message: ${lastMessageText.length} characters)`));
            const result = await chatSession.sendMessage(lastMessageText);

            if (result.response && typeof result.response.text === 'function') {
                const responseText = result.response.text();
                console.log(chalk.blue(`Received response from ${this.modelName}. (${responseText.length} characters)`));
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
            this.handleError(error, this.modelName);
            return ''; // Unreachable
        }
    }

    // --- *** NEW/MODIFIED: generateContent Method *** ---
    async generateContent(request: GenerateContentRequest): Promise<GenerateContentResult> {
        let attempts = 0;
        while (attempts <= this.maxRetries) {
            try {
                console.log(chalk.blue(`Calling generateContent on ${this.modelName} (Attempt ${attempts + 1}/${this.maxRetries + 1})...`));
                // Add generationConfig if not already present in the request, respecting existing one
                const finalRequest: GenerateContentRequest = {
                    ...request,
                    generationConfig: {
                        maxOutputTokens: this.config.gemini.max_output_tokens || 8192, // Use same default for now
                        ...(request.generationConfig || {}), // Merge existing config
                    },
                    // Ensure safety settings are passed if needed, or use defaults
                    // safetySettings: request.safetySettings || [...default safety settings...],
                };

                // Make the API call using the model instance
                const result = await this.model.generateContent(finalRequest);

                // --- Enhanced Response Validation ---
                if (!result || !result.response) {
                    // This indicates a likely API issue or unexpected empty response
                    console.warn(chalk.yellow(`generateContent call to ${this.modelName} returned an empty result/response object.`));
                    throw new Error(`AI response from ${this.modelName} was unexpectedly empty.`); // Throw to retry or fail
                }

                const candidate = result.response.candidates?.[0];
                const finishReason = candidate?.finishReason;

                // Check for explicit blocking reasons
                if (finishReason && finishReason !== FinishReason.STOP && finishReason !== FinishReason.MAX_TOKENS) { // Allow MAX_TOKENS, handle later if needed
                    console.warn(chalk.yellow(`Model ${this.modelName} finished with reason: ${finishReason}.`));
                    let reasonDetails = '';
                    if (finishReason === FinishReason.SAFETY) {
                        reasonDetails = ` Safety Ratings: ${JSON.stringify(candidate?.safetyRatings)}`;
                        console.warn(chalk.yellow(reasonDetails));
                    }
                    // Throw an error that might be retried or indicate a failure
                    const blockError = new Error(`Model ${this.modelName} generation blocked. Reason: ${finishReason}.${reasonDetails}`);
                    (blockError as any).code = finishReason; // Add reason code
                    throw blockError;
                }

                // Check if a function call OR text is present (successful response)
                const hasFunctionCall = !!candidate?.content?.parts?.some(p => p.functionCall);
                const hasText = !!candidate?.content?.parts?.some(p => p.text);

                if (!hasFunctionCall && !hasText && finishReason === FinishReason.STOP) {
                    // Model finished normally but produced neither text nor function call - might be valid but unusual
                    console.warn(chalk.yellow(`Model ${this.modelName} finished normally but produced no text or function call.`));
                    // Return the result, let the caller decide how to handle this
                }
                // --- End Enhanced Validation ---

                return result; // Success

            } catch (error: any) {
                const errorCode = (error as any).code || 'UNKNOWN'; // Get error code if attached by handleError or added by us
                const isRetryable = ['RATE_LIMIT', 'SERVER_OVERLOADED', 'NETWORK_ERROR', 'NO_RESPONSE'].includes(errorCode);

                console.error(chalk.red(`Error during generateContent (Attempt ${attempts + 1}) using ${this.modelName}:`), error.message);

                if (isRetryable && attempts < this.maxRetries) {
                    attempts++;
                    const delay = this.retryBaseDelay * Math.pow(2, attempts - 1); // Exponential backoff
                    console.log(chalk.yellow(`Retrying in ${delay / 1000}s... (${attempts}/${this.maxRetries})`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Retry the loop
                } else {
                    // Non-retryable error OR max retries reached
                    console.error(chalk.red(`generateContent failed after ${attempts + 1} attempts for ${this.modelName}.`));
                    // Use the detailed error handler to format and re-throw
                    this.handleError(error, this.modelName);
                    // This throw will happen if handleError doesn't (it should)
                    throw error;
                }
            }
        }
        // Should not be reached if maxRetries >= 0, but need return for TS
        throw new Error(`generateContent failed definitively after ${this.maxRetries + 1} attempts for ${this.modelName}.`);
    }
    // --- *** END NEW METHOD *** ---


    // --- convertToGeminiConversation (Identical structure - Unchanged) ---
    convertToGeminiConversation(messages: Message[]): GeminiChatHistory {
        // Filter out system messages as they are handled differently in Gemini API (often via systemInstruction)
        // Or merge consecutive messages of the same role if needed by the API constraints
        const history: GeminiChatHistory = [];
        let lastRole: 'user' | 'model' | null = null;

        for (const msg of messages) {
            if (!msg.role || !msg.content || msg.role === 'system') continue; // Skip system messages

            const currentRole = msg.role === 'assistant' ? 'model' : 'user';

            if (history.length > 0 && currentRole === lastRole) {
                // Merge content with the last message of the same role
                history[history.length - 1].parts.push({ text: msg.content });
            } else {
                // Add a new message entry
                history.push({ role: currentRole, parts: [{ text: msg.content }] });
                lastRole = currentRole;
            }
        }
        return history;
    }

    // --- handleError (Accepts modelName, structure Unchanged) ---
    handleError(error: any, modelName: string): void { // modelName is required here
        let errorMessage = `An error occurred while making the AI API request (using ${modelName}).`;
        let errorCode = 'UNKNOWN';

        // Network Error (FetchError or similar)
        if (error instanceof Error && (error.message.includes('FETCH_ERROR') || error.message.includes('fetch failed') || error.name === 'FetchError')) {
            errorMessage = `\n⚠️ Network Error (using ${modelName}): ${error.message}`;
            errorCode = 'NETWORK_ERROR';
        }
            // API Error Response (Structure from @google/generative-ai or http errors)
        // Look for status codes or specific API error messages
        else if (error.status && typeof error.status === 'number') { // Likely an HTTP error object from the SDK
            errorMessage += `\n❌ HTTP Status: ${error.status}`;
            errorMessage += `\n📌 AI Error Details: ${error.message || JSON.stringify(error)}`; // Use message or full error
            errorCode = `API_ERROR_${error.status}`;
            if (error.status === 400 && error.message?.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
            if (error.status === 429) errorCode = 'RATE_LIMIT';
            if (error.status === 500 || error.status === 503) errorCode = 'SERVER_OVERLOADED';
        }
        // GoogleGenerativeAI specific error structure (e.g., content safety)
        else if (error instanceof Error && error.message.includes('[GoogleGenerativeAI Error]')) {
            errorMessage += `\n⚠️ Google AI Error: ${error.message}`;
            // Use the finishReason if available and indicates blocking
            if (error.message.includes('SAFETY') || (error as any).code === FinishReason.SAFETY) errorCode = 'SAFETY_BLOCK';
            if (error.message.includes('recitation') || (error as any).code === FinishReason.RECITATION) errorCode = 'RECITATION_BLOCK'; // Example
            // Add more specific checks based on observed errors from the SDK
        }
        // Error object with a specific 'code' property (like NodeJS errors)
        else if (error.code && typeof error.code === 'string') {
            errorMessage += `\n⚠️ System/Code Error: ${error.code} - ${error.message}`;
            errorCode = error.code; // Use the existing code
        }
        // No Response Error (might be caught as network error, but check specifically)
        else if (error.request) { // Less common with fetch-based SDKs, more with axios/http
            errorMessage += `\n⏳ No response received from ${modelName}. Possible network issue or timeout.`;
            errorCode = 'NO_RESPONSE';
        }
        // General Error Message
        else if (error.message) {
            errorMessage += `\n⚠️ General Error: ${error.message}`;
            // Try to infer code from message content if possible
            if (error.message.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
            if (error.message.includes('429') || error.message.toLowerCase().includes('rate limit')) errorCode = 'RATE_LIMIT';
            if (error.message.includes('500') || error.message.includes('503') || error.message.toLowerCase().includes('server error')) errorCode = 'SERVER_OVERLOADED';
            if (error.message.toLowerCase().includes('safety')) errorCode = 'SAFETY_BLOCK';
        }
        // Fallback for unknown error types
        else {
            errorMessage += `\n❓ An unexpected error occurred with ${modelName}. ${JSON.stringify(error)}`;
        }

        console.error(chalk.red(errorMessage));

        // Create a new error object, attach the code, and throw it
        const codedError = new Error(`AI API Error (${errorCode}) using ${modelName}: ${error.message || 'Details in console log.'}`);
        (codedError as any).code = errorCode; // Attach the determined code
        throw codedError; // Throw the enhanced error
    }
}

export default Gemini2FlashModel;