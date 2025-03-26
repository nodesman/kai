// File: src/lib/AIClient.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import Gemini2ProModel from "./models/Gemini2ProModel"; // Assuming this model handles the actual API call
import { Config } from "./Config";
import Conversation, { Message } from "./models/Conversation";
import chalk from 'chalk'; // For better console logging
import { encode as gpt3Encode } from 'gpt-3-encoder'; // For token counting

// --- LogEntry Types (Unchanged) ---
interface LogEntryBase {
    type: string;
    timestamp: string;
}

interface RequestLogEntry extends LogEntryBase {
    type: 'request';
    role: 'user'; // Role is expected here
    content: string;
}

interface ResponseLogEntry extends LogEntryBase {
    type: 'response';
    role: 'assistant'; // Role is expected here
    content: string;
}

interface ErrorLogEntry extends LogEntryBase {
    type: 'error';
    error: string;
}

type LogEntry = RequestLogEntry | ResponseLogEntry | ErrorLogEntry;

type LogEntryData =
    | Omit<RequestLogEntry, 'timestamp'>
    | Omit<ResponseLogEntry, 'timestamp'>
    | Omit<ErrorLogEntry, 'timestamp'>;
// --- End LogEntry Types ---

class AIClient {
    fs: FileSystem;
    model: Gemini2ProModel; // Instance of the class that calls the Gemini API
    config: Config;

    constructor(config: Config) {
        this.config = config;
        // Ensure Gemini2ProModel is instantiated correctly
        // It should likely accept the config as well for API key/model name
        this.model = new Gemini2ProModel(config);
        this.fs = new FileSystem();
    }

    // Helper for token counting
    private countTokens(text: string): number {
        return gpt3Encode(text).length;
    }

    // --- logConversation (Unchanged) ---
    async logConversation(conversationFilePath: string, entryData: LogEntryData): Promise<void> {
        const timestamp = new Date().toISOString();
        const logData: LogEntry = { ...entryData, timestamp }; // Add timestamp

        try {
            await this.fs.appendJsonlFile(conversationFilePath, logData);
        } catch (err) {
            // Log error to console, but don't crash the main flow
            console.error(chalk.red(`Error writing to log file ${conversationFilePath}:`), err);
        }
    }

    // --- MODIFIED getResponseFromAI ---
    async getResponseFromAI(
        conversation: Conversation,
        conversationFilePath: string,
        // Add the optional contextString parameter
        contextString?: string
    ): Promise<void> { // Changed return type to void as it mutates conversation

        const messages = conversation.getMessages(); // Get all current messages
        const lastMessage = messages[messages.length - 1];

        // Basic validation
        if (!lastMessage || lastMessage.role !== 'user') {
            console.error(chalk.red("Conversation history doesn't end with a user message. Aborting AI call."));
            // Log error and throw to indicate failure
            await this.logConversation(conversationFilePath, {
                type: 'error',
                error: "Internal error: Conversation history doesn't end with a user message."
            });
            throw new Error("Conversation history must end with a user message to get AI response.");
        }

        // --- Log the ORIGINAL user request for the persistent history ---
        // This happens *before* we potentially modify the content for the API call
        await this.logConversation(conversationFilePath, {
            type: 'request',
            role: 'user',
            content: lastMessage.content // Log the user's actual input
        });

        let messagesForModel: Message[];
        let contextTokenCount = 0;

        // --- Prepare the messages payload for the model ---
        if (contextString && contextString.length > "Code Base Context:\n".length) { // Check if context has content
            contextTokenCount = this.countTokens(contextString);
            console.log(chalk.magenta(`Prepending context (${contextTokenCount} tokens) to final user prompt for AI call.`));

            // Create the enhanced prompt text for the *last* message
            const finalUserPromptText =
                `This is the code base for which the aforementioned conversation history is for:
${contextString}

---
User Question:
${lastMessage.content}`; // Append original user question

            // Create a *new* array with the modified last message
            // This avoids mutating the original 'messages' array or the 'conversation' object yet
            messagesForModel = [
                ...messages.slice(0, -1), // All messages before the last one
                { // The modified last user message object
                    ...lastMessage, // Copy other properties like role
                    content: finalUserPromptText // Use the combined text
                }
            ];

        } else {
            // No context string provided, use messages as they are
            messagesForModel = messages;
            console.log(chalk.gray("No context string provided or context is empty. Sending messages as is."));
        }

        // --- Make the call to the underlying model ---
        try {
            // **Crucial Change:** Pass the potentially modified `messagesForModel` array
            // Assuming Gemini2ProModel's method now accepts Message[]
            // You *might* need to adapt Gemini2ProModel.getResponseFromAI signature
            // from getResponseFromAI(conversation: Conversation) to
            // getResponseFromAI(messages: Message[])
            const responseText = await this.model.getResponseFromAI(messagesForModel);

            // --- Log the AI response ---
            await this.logConversation(conversationFilePath, {
                type: 'response',
                role: 'assistant',
                content: responseText
            });

            // --- Add AI response to the ORIGINAL conversation object ---
            // This ensures the persistent history remains clean
            conversation.addMessage('assistant', responseText);

            // No return value needed as we mutated the conversation object
            // (Changed from Promise<string> to Promise<void>)

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red("Error getting response from AI model:"), errorMessage);

            // --- Log the error ---
            await this.logConversation(conversationFilePath, {
                type: 'error',
                error: `AI Model Error: ${errorMessage}`
            });

            // Re-throw the error so the caller (CodeProcessor) knows the operation failed
            throw error;
        }
    }
}

export { AIClient, LogEntry }; // Export LogEntry if needed elsewhere