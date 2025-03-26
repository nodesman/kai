// lib/models/Gemini2FlashModel.ts
import BaseModel from "./BaseModel";
import { GoogleGenerativeAI, Content, GenerativeModel } from "@google/generative-ai";
import { Config } from "../Config";
import { Message } from "../models/Conversation"; // Correct path
import chalk from 'chalk';

// Types for internal conversion
interface GeminiMessagePart { text: string; }
interface GeminiMessage { role: "user" | "model"; parts: GeminiMessagePart[]; }
type GeminiChatHistory = GeminiMessage[];

class Gemini2FlashModel extends BaseModel {
    genAI: GoogleGenerativeAI;
    modelName: string; // Store the specific model name for this instance
    model: GenerativeModel; // The specific model instance

    constructor(config: Config) {
        super(config);
        if (!config.gemini?.api_key) {
            throw new Error("Gemini API key is missing in the configuration.");
        }
        this.genAI = new GoogleGenerativeAI(config.gemini.api_key);
        // Use the subsequent_chat_model_name or default to Flash
        this.modelName = config.gemini.subsequent_chat_model_name || "gemini-2.0-flash"; // Default to Flash
        console.log(chalk.yellow(`Initializing Gemini Flash Model instance with: ${this.modelName}`));
        try {
            this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        } catch (error) {
            console.error(chalk.red(`Failed to initialize model ${this.modelName}:`), error);
            throw new Error(`Failed to get generative model for ${this.modelName}. Check model name and API key validity.`);
        }
    }

    // No modelName override parameter needed here
    async getResponseFromAI(messages: Message[]): Promise<string> {
        if (!messages || messages.length === 0) {
            throw new Error("Cannot get AI response with empty message history.");
        }
        const geminiConversation: GeminiChatHistory = this.convertToGeminiConversation(messages);
        // Call queryGemini without override
        return this.queryGemini(geminiConversation);
    }

    // No modelName override parameter needed here
    async queryGemini(geminiMessages: GeminiChatHistory): Promise<string> {
        // Directly use the model instance created in the constructor (this.model)
        // and its configured name (this.modelName)
        try {
            const generationConfig = {
                maxOutputTokens: this.config.gemini.max_output_tokens || 8192, // Use config or default
            };

            const historyForChat = geminiMessages.slice(0, -1);
            const lastMessageToSend = geminiMessages[geminiMessages.length - 1];

            if (!lastMessageToSend || lastMessageToSend.role !== "user") {
                throw new Error("Internal Error: Last message prepared must be from the user.");
            }

            // Use the model instance stored in this.model
            const chatSession = this.model.startChat({
                history: historyForChat as Content[],
                generationConfig,
            });

            const lastMessageText = lastMessageToSend.parts.map((part) => part.text).join('');
            console.log(chalk.blue(`Sending prompt to ${this.modelName}... (Last message length: ${lastMessageText.length})`));

            const result = await chatSession.sendMessage(lastMessageText);

            if (result.response && typeof result.response.text === 'function') {
                const responseText = result.response.text();
                console.log(chalk.blue(`Received response from ${this.modelName}. (Length: ${responseText.length})`));
                return responseText;
            } else {
                const finishReason = result.response?.candidates?.[0]?.finishReason;
                const safetyRatings = result.response?.candidates?.[0]?.safetyRatings;
                let blockReason = finishReason ? `Finish Reason: ${finishReason}` : 'Reason unknown.';
                if (finishReason === 'SAFETY' && safetyRatings) {
                    blockReason += ` Safety Ratings: ${JSON.stringify(safetyRatings)}`;
                }
                throw new Error(`AI response from ${this.modelName} missing content. ${blockReason}`);
            }
        } catch (error) {
            // Pass the specific model name of this instance to the error handler
            this.handleError(error, this.modelName);
            return ''; // Unreachable due to handleError throwing
        }
    }

    // --- convertToGeminiConversation (Identical to Pro version) ---
    convertToGeminiConversation(messages: Message[]): GeminiChatHistory {
        return messages.map((msg): GeminiMessage | null => {
            if (!msg.role || !msg.content) return null;
            const role = msg.role === 'assistant' ? 'model' : 'user';
            if (role !== 'user' && role !== 'model') return null;
            return { role: role, parts: [{ text: msg.content }] };
        }).filter((msg): msg is GeminiMessage => msg !== null);
    }

    // --- handleError (Accepts modelName, identical to Pro version structure) ---
    handleError(error: any, modelName: string): void { // modelName is required here
        let errorMessage = `An error occurred while making the AI API request (using ${modelName}).`;
        let errorCode = 'UNKNOWN';
        // ... (rest of error handling logic identical to the previous Gemini2ProModel version) ...
        if (error instanceof Error && error.message.includes(' FetchError:')) { /*...*/ }
        else if (error.response) { /*...*/ }
        else if (error.request) { /*...*/ }
        else if (error.message) { /*...*/ }
        else { /*...*/ }

        console.error(chalk.red(errorMessage));
        const codedError = new Error(`AI API Error (${errorCode}) using ${modelName}: ${error.message || 'Details in console log.'}`);
        (codedError as any).code = errorCode;
        throw codedError;
    }
}

export default Gemini2FlashModel;