// lib/models/Gemini2ProModel.ts
import BaseModel from "./BaseModel";
import { GoogleGenerativeAI, Content, Part } from "@google/generative-ai"; // Import specific types
import { Config } from "../Config";
// We still need Message from Conversation, but not Conversation itself for the method signature
import { Message } from "./Conversation";
import chalk from 'chalk'; // Import chalk for logging

// Gemini-specific types (internal use) - Using SDK's Content/Part is often better
// Keeping GeminiChatHistory for clarity in this context, maps closely to Content[]
interface GeminiMessagePart {
    text: string;
}
// Use SDK's roles 'user' | 'model' directly
interface GeminiMessage {
    role: "user" | "model";
    parts: GeminiMessagePart[];
}
type GeminiChatHistory = GeminiMessage[]; // Equivalent to Content[]

class Gemini2ProModel extends BaseModel {
    genAI: GoogleGenerativeAI;
    modelName: string;
    // Use the specific type from the SDK if possible, otherwise 'any' is a fallback
    model: any; // Replace 'any' with GenerativeModel if using SDK types directly

    constructor(config: Config) {
        super(config);
        if (!config.gemini?.api_key) { // Use optional chaining and check
            throw new Error("Gemini API key is missing in the configuration.");
        }
        this.genAI = new GoogleGenerativeAI(config.gemini.api_key);
        // Consider making modelName configurable via config
        this.modelName = config.gemini.model_name || "gemini-2.5-pro-exp-03-25"; // Fallback to a known model
        console.log(chalk.yellow(`Initializing Gemini Model: ${this.modelName}`));
        this.model = this.genAI.getGenerativeModel({ model: this.modelName });
    }

    // --- MODIFIED: Accepts Message[] instead of Conversation ---
    async getResponseFromAI(messages: Message[]): Promise<string> {
        if (!messages || messages.length === 0) {
            throw new Error("Cannot get AI response with empty message history.");
        }
        // Convert our internal Message format to Gemini's format
        const geminiConversation: GeminiChatHistory = this.convertToGeminiConversation(messages);
        // Call the method that interacts with the Gemini API
        return this.queryGemini(geminiConversation);
    }

    // --- Corrected queryGemini logic ---
    async queryGemini(geminiMessages: GeminiChatHistory): Promise<string> {
        try {
            // Configuration for the generation - consider making these configurable
            const generationConfig = {
                // temperature: 1, // Often defaults are good, uncomment to override
                // topP: 0.95,
                // topK: 64,
                maxOutputTokens: this.config.gemini.max_output_tokens || 8192, // Use config value or default
                // Add safetySettings if needed from config
                // safetySettings: this.config.gemini.safetySettings
            };

            // The history for startChat should include all messages *except* the last one
            const historyForChat = geminiMessages.slice(0, -1);
            // The last message is the one we will send
            const lastMessageToSend = geminiMessages[geminiMessages.length - 1];

            // Validate the last message is from the user
            if (!lastMessageToSend || lastMessageToSend.role !== "user") {
                console.error(chalk.red("❌ Error: The last message in the prepared history must be from the user."));
                throw new Error("Internal Error: The last message prepared for the AI must be from the user.");
            }

            // Start the chat session with the preceding history
            const chatSession = this.model.startChat({
                history: historyForChat as Content[], // Cast to SDK type Content[]
                generationConfig,
                // safetySettings: generationConfig.safetySettings // Pass safety settings if defined
            });

            // Extract the text content from the last message parts
            // Use SDK types (Part) if possible for better type safety
            const lastMessageText = lastMessageToSend.parts.map((part: GeminiMessagePart) => part.text).join('');

            console.log(chalk.blue(`Sending prompt to ${this.modelName}... (Last message length: ${lastMessageText.length})`));

            // Send the content of the *last* message
            const result = await chatSession.sendMessage(lastMessageText);

            // It's good practice to check if the response and text exist
            if (result.response && typeof result.response.text === 'function') {
                const responseText = result.response.text();
                console.log(chalk.blue(`Received response from ${this.modelName}. (Length: ${responseText.length})`));
                return responseText;
            } else {
                // Handle cases where the response might be blocked or empty
                console.warn(chalk.yellow("⚠️ AI response received but content is missing or invalid."), result.response);
                throw new Error("AI response received but content is missing or invalid.");
            }


        } catch (error) {
            // Use the existing error handler, which logs and re-throws
            this.handleError(error);
            // Since handleError always throws, this part is technically unreachable,
            // but returning an empty string satisfies TypeScript if needed.
            return '';
        }
    }

    // --- convertToGeminiConversation (Unchanged) ---
    // Converts our internal Message[] to Gemini's format GeminiChatHistory (Content[])
    convertToGeminiConversation(messages: Message[]): GeminiChatHistory {
        return messages.map((msg): GeminiMessage | null => { // Return null for invalid messages
            if (!msg.role || !msg.content) {
                console.warn(chalk.yellow("Skipping invalid message (missing role or content):"), msg);
                return null; // Skip this message
            }

            // Map 'assistant' role to 'model'
            const role = msg.role === 'assistant' ? 'model' : 'user';

            // Ensure role is valid for Gemini
            if (role !== 'user' && role !== 'model') {
                console.warn(chalk.yellow(`Skipping message with invalid role for Gemini ('${msg.role}'):`), msg);
                return null;
            }


            return {
                role: role,
                parts: [{ text: msg.content }],
            };
        }).filter((msg): msg is GeminiMessage => msg !== null); // Filter out nulls and assert type
    }

    // --- flattenMessages (No longer seems used, can be removed if desired) ---
    // flattenMessages(conversation: any): any[] { ... }

    // --- handleError (Unchanged) ---
    handleError(error: any): void {
        let errorMessage = "An error occurred while making the AI API request.";
        let errorCode = 'UNKNOWN'; // Add error code tracking

        // Check for specific GoogleGenerativeAI error structure
        if (error instanceof Error && error.message.includes(' FetchError:')) {
            errorMessage = `\n⚠️ Network Error: ${error.message}`;
            errorCode = 'NETWORK_ERROR';
        } else if (error.response) { // Check for errors with response structure (e.g., API errors)
            // Attempt to parse Google API error details if available
            const details = error.response.data?.error?.message || JSON.stringify(error.response.data, null, 2);
            errorMessage += `\n❌ HTTP Status: ${error.response.status}`;
            errorMessage += `\n📌 AI Error Message: ${details}`;
            errorCode = `API_ERROR_${error.response.status}`;
        } else if (error.request) { // Error during request setup, no response
            errorMessage += `\n⏳ No response received. Possible network issues or server timeout.`;
            errorCode = 'NO_RESPONSE';
        } else if (error.message) { // Generic error message
            errorMessage += `\n⚠️ Error: ${error.message}`;
            // Try to guess code from message (e.g., safety settings)
            if (error.message.includes('SAFETY')) errorCode = 'SAFETY_BLOCK';
            if (error.message.includes('API key not valid')) errorCode = 'INVALID_API_KEY';
        } else { // Fallback
            errorMessage += `\n❓ An unexpected error occurred.`;
        }

        console.error(chalk.red(errorMessage)); // Log the detailed error message

        // Throw a new error that includes the code and original message for better upstream handling
        const codedError = new Error(`AI API Error (${errorCode}): ${error.message || 'Details in console log.'}`);
        (codedError as any).code = errorCode; // Attach code for easier checking
        throw codedError;
    }
}

export default Gemini2ProModel;