// lib/models/Gemini2FlashModel.ts (and similarly for Gemini2ProModel.ts)
import BaseModel from "./BaseModel";
import {
    GoogleGenerativeAI,
    Content, // Keep for chat history conversion
    GenerativeModel,
    GenerateContentRequest, // Import request type
    GenerateContentResult,  // Import result type
    Part,                  // Import Part type
} from "@google/generative-ai";
import { Config } from "../Config";
import { Message } from "../models/Conversation";
import chalk from 'chalk';

// Types for internal conversion (unchanged)
interface GeminiMessagePart { text: string; }
interface GeminiMessage { role: "user" | "model"; parts: GeminiMessagePart[]; }
type GeminiChatHistory = GeminiMessage[];

class Gemini2FlashModel extends BaseModel { // Or Gemini2ProModel
    genAI: GoogleGenerativeAI;
    modelName: string;
    model: GenerativeModel;

    constructor(config: Config) {
        super(config);
        // ... constructor logic remains the same ...
        if (!config.gemini?.api_key) throw new Error("Gemini API key missing.");
        this.genAI = new GoogleGenerativeAI(config.gemini.api_key);
        // --- Adjust model name based on class ---
        // For Flash:
        this.modelName = config.gemini.subsequent_chat_model_name || "gemini-2.0-flash";
        // For Pro:
        // this.modelName = config.gemini.model_name || "gemini-2.5-pro-exp-03-25";
        // --- End adjustment ---
        console.log(chalk.yellow(`Initializing Gemini Model instance with: ${this.modelName}`));
        try {
            this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        } catch (error) {
            console.error(chalk.red(`Failed to initialize model ${this.modelName}:`), error);
            throw new Error(`Failed to get generative model for ${this.modelName}. Check model name and API key validity.`);
        }
    }

    // --- getResponseFromAI (for Chat - Unchanged) ---
    async getResponseFromAI(messages: Message[]): Promise<string> {
        // ... Implementation remains the same ...
        if (!messages || messages.length === 0) throw new Error("Empty message history.");
        const geminiConversation: GeminiChatHistory = this.convertToGeminiConversation(messages);
        return this.queryGeminiChat(geminiConversation); // Renamed internal method for clarity
    }

    // Renamed from queryGemini to queryGeminiChat to avoid confusion with generateContent
    async queryGeminiChat(geminiMessages: GeminiChatHistory): Promise<string> {
        // ... Implementation remains the same as the previous queryGemini ...
        try {
            const generationConfig = {
                maxOutputTokens: this.config.gemini.max_output_tokens || 8192,
            };
            const historyForChat = geminiMessages.slice(0, -1);
            const lastMessageToSend = geminiMessages[geminiMessages.length - 1];
            if (!lastMessageToSend || lastMessageToSend.role !== "user") throw new Error("Internal Error: Last message must be user.");

            const chatSession = this.model.startChat({
                history: historyForChat as Content[],
                generationConfig,
            });
            const lastMessageText = lastMessageToSend.parts.map((part) => part.text).join('');
            console.log(chalk.blue(`Sending prompt to ${this.modelName}... (Last message length: ${lastMessageText.length})`));
            const result = await chatSession.sendMessage(lastMessageText);

            // Response processing logic... (unchanged)
            if (result.response && typeof result.response.text === 'function') {
                const responseText = result.response.text();
                console.log(chalk.blue(`Received response from ${this.modelName}. (Length: ${responseText.length})`));
                return responseText;
            } else {
                // Error handling for missing text... (unchanged)
                const finishReason = result.response?.candidates?.[0]?.finishReason;
                const safetyRatings = result.response?.candidates?.[0]?.safetyRatings;
                let blockReason = finishReason ? `Finish Reason: ${finishReason}` : 'Reason unknown.';
                if (finishReason === 'SAFETY' && safetyRatings) {
                    blockReason += ` Safety Ratings: ${JSON.stringify(safetyRatings)}`;
                }
                throw new Error(`AI response from ${this.modelName} missing content. ${blockReason}`);
            }
        } catch (error) {
            this.handleError(error, this.modelName); // Pass model name
            return ''; // Unreachable
        }
    }

    // --- *** NEW: generateContent Method *** ---
    async generateContent(request: GenerateContentRequest): Promise<GenerateContentResult> {
        try {
            console.log(chalk.blue(`Calling generateContent on ${this.modelName}...`));
            // Add generationConfig if not already present in the request, respecting existing one
            const finalRequest: GenerateContentRequest = {
                ...request,
                generationConfig: {
                    maxOutputTokens: this.config.gemini.max_output_tokens || 8192,
                    ...(request.generationConfig || {}), // Merge existing config
                },
            };

            // Make the API call using the model instance
            const result = await this.model.generateContent(finalRequest);

            // Basic check for response validity before returning
            if (!result || !result.response) {
                console.warn(chalk.yellow(`generateContent call to ${this.modelName} returned an empty result/response.`));
                // You might want to throw an error here depending on expected behavior
                throw new Error(`AI response from ${this.modelName} was unexpectedly empty.`);
            }

            // Log finish reason if not OK
            const finishReason = result.response?.candidates?.[0]?.finishReason;
            if (finishReason && finishReason !== 'STOP') {
                console.warn(chalk.yellow(`Model ${this.modelName} finished with reason: ${finishReason}`));
                if (finishReason === 'SAFETY') {
                    console.warn(chalk.yellow(`Safety Ratings: ${JSON.stringify(result.response?.candidates?.[0]?.safetyRatings)}`));
                }
            }


            return result;
        } catch (error) {
            // Use the existing detailed error handler
            this.handleError(error, this.modelName);
            // handleError throws, so this next line is technically unreachable
            // but needed for type safety if handleError were modified.
            throw error;
        }
    }
    // --- *** END NEW METHOD *** ---

    // --- convertToGeminiConversation (Unchanged) ---
    convertToGeminiConversation(messages: Message[]): GeminiChatHistory {
        // ... Implementation remains the same ...
        return messages.map((msg): GeminiMessage | null => {
            if (!msg.role || !msg.content) return null;
            const role = msg.role === 'assistant' ? 'model' : 'user';
            if (role !== 'user' && role !== 'model') return null; // Skip system messages for Gemini history
            return { role: role, parts: [{ text: msg.content }] };
        }).filter((msg): msg is GeminiMessage => msg !== null);
    }

    // --- handleError (Unchanged) ---
    handleError(error: any, modelName: string): void {
        // ... Implementation remains the same ...
        let errorMessage = `An error occurred while making the AI API request (using ${modelName}).`;
        let errorCode = 'UNKNOWN';
        // Network Error
        if (error instanceof Error && (error.message.includes('FETCH_ERROR') || error.message.includes('fetch failed'))) {
            errorMessage = `\n⚠️ Network Error (using ${modelName}): ${error.message}`;
            errorCode = 'NETWORK_ERROR';
        }
        // API Error Response
        else if (error.response && error.response.data && error.response.data.error) {
            const details = error.response.data.error.message || JSON.stringify(error.response.data.error);
            errorMessage += `\n❌ HTTP Status: ${error.response.status}`;
            errorMessage += `\n📌 AI Error Message: ${details}`;
            errorCode = `API_ERROR_${error.response.status}`;
            if (error.response.status === 429) errorCode = 'RATE_LIMIT';
            if (error.response.status === 400 && details.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
            if (error.response.status === 500 || error.response.status === 503) errorCode = 'SERVER_OVERLOADED';

        }
        // GoogleGenerativeAI specific error structure (e.g., safety)
        else if (error instanceof Error && error.message.includes('[GoogleGenerativeAI Error]')) {
            errorMessage += `\n⚠️ Google AI Error: ${error.message}`;
            if (error.message.includes('SAFETY')) errorCode = 'SAFETY_BLOCK';
            // Add more specific checks if needed based on observed errors
        }
        // No Response Error
        else if (error.request) {
            errorMessage += `\n⏳ No response received. Possible network issues or server timeout.`;
            errorCode = 'NO_RESPONSE';
        }
        // General Error Message
        else if (error.message) {
            errorMessage += `\n⚠️ Error: ${error.message}`;
            // Check common messages again just in case they weren't caught above
            if (!errorCode || errorCode === 'UNKNOWN') {
                if (error.message.includes('SAFETY')) errorCode = 'SAFETY_BLOCK';
                if (error.message.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
                if (error.message.includes('429')) errorCode = 'RATE_LIMIT';
                if (error.message.includes('503') || error.message.includes('500')) errorCode = 'SERVER_OVERLOADED';
            }
        }
        // Fallback
        else {
            errorMessage += `\n❓ An unexpected error occurred. ${JSON.stringify(error)}`;
        }

        console.error(chalk.red(errorMessage));
        const codedError = new Error(`AI API Error (${errorCode}) using ${modelName}: ${error.message || 'Details in console log.'}`);
        (codedError as any).code = errorCode; // Attach the code
        throw codedError; // Throw the error
    }
}

// Make sure to export the correct class name
export default Gemini2FlashModel; // or Gemini2ProModel