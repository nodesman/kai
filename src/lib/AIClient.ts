// File: src/lib/AIClient.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import Gemini2ProModel from "./models/Gemini2ProModel"; // Assuming this model handles the actual API call
import { Config } from "./Config";
import Conversation, { Message } from "./models/Conversation";
import chalk from 'chalk'; // For better console logging
import { encode as gpt3Encode } from 'gpt-3-encoder'; // For token counting

// --- LogEntry Types (Unchanged from provided context) ---
interface LogEntryBase {
    type: string;
    timestamp: string;
}

interface RequestLogEntry extends LogEntryBase {
    type: 'request';
    role: 'user';
    content: string;
}

interface ResponseLogEntry extends LogEntryBase {
    type: 'response';
    role: 'assistant';
    content: string;
}

interface SystemLogEntry extends LogEntryBase {
    type: 'system';
    role: 'system';
    content: string;
}

interface ErrorLogEntry extends LogEntryBase {
    type: 'error';
    error: string;
    // Optional: Add role if errors can be associated with a step
    role?: 'system' | 'user' | 'assistant';
}

// Allow LogEntryData to represent SystemLogEntry as well
type LogEntry = RequestLogEntry | ResponseLogEntry | ErrorLogEntry | SystemLogEntry;

type LogEntryData =
    | Omit<RequestLogEntry, 'timestamp'>
    | Omit<ResponseLogEntry, 'timestamp'>
    | Omit<ErrorLogEntry, 'timestamp'>
    | Omit<SystemLogEntry, 'timestamp'>; // Add SystemLogEntry here
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

    // --- logConversation (Unchanged but ensure it handles SystemLogEntry) ---
    async logConversation(conversationFilePath: string, entryData: LogEntryData): Promise<void> {
        const timestamp = new Date().toISOString();
        // Type assertion needed as entryData doesn't perfectly map to LogEntry structure initially
        const logData: LogEntry = { ...entryData, timestamp } as LogEntry;

        try {
            await this.fs.appendJsonlFile(conversationFilePath, logData);
        } catch (err) {
            // Log error to console, but don't crash the main flow
            console.error(chalk.red(`Error writing to log file ${conversationFilePath}:`), err);
        }
    }

    // --- getResponseFromAI (Handles context, logging, history mutation) ---
    async getResponseFromAI(
        conversation: Conversation,
        conversationFilePath: string,
        contextString?: string
    ): Promise<void> { // Returns void as it mutates conversation

        const messages = conversation.getMessages(); // Get all current messages
        const lastMessage = messages[messages.length - 1];

        // Basic validation
        if (!lastMessage || lastMessage.role !== 'user') {
            console.error(chalk.red("Conversation history doesn't end with a user message. Aborting AI call."));
            await this.logConversation(conversationFilePath, {
                type: 'error',
                error: "Internal error: Conversation history doesn't end with a user message."
            });
            throw new Error("Conversation history must end with a user message to get AI response.");
        }

        // --- Log the ORIGINAL user request ---
        await this.logConversation(conversationFilePath, {
            type: 'request',
            role: 'user',
            content: lastMessage.content // Log the user's actual input
        });

        let messagesForModel: Message[];
        let contextTokenCount = 0;

        // --- Prepare messages for the model, potentially adding context ---
        if (contextString && contextString.length > "Code Base Context:\n".length) {
            contextTokenCount = this.countTokens(contextString);
            console.log(chalk.magenta(`Prepending context (${contextTokenCount} tokens) to final user prompt for AI call.`));

            const finalUserPromptText =
                `This is the code base for which the aforementioned conversation history is for:\n${contextString}\n\n---\nUser Question:\n${lastMessage.content}`;

            messagesForModel = [
                ...messages.slice(0, -1),
                { ...lastMessage, content: finalUserPromptText }
            ];
        } else {
            messagesForModel = messages;
            console.log(chalk.gray("No context string provided or context is empty. Sending messages as is."));
        }

        // --- Make the call to the underlying model ---
        try {
            // Pass the potentially modified messagesForModel array
            // Assumes Gemini2ProModel.getResponseFromAI accepts Message[]
            const responseText = await this.model.getResponseFromAI(messagesForModel);

            // --- Log the AI response ---
            await this.logConversation(conversationFilePath, {
                type: 'response',
                role: 'assistant',
                content: responseText
            });

            // --- Add AI response to the ORIGINAL conversation object ---
            conversation.addMessage('assistant', responseText);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red("Error getting response from AI model:"), errorMessage);

            // Log the error
            await this.logConversation(conversationFilePath, {
                type: 'error',
                error: `AI Model Error: ${errorMessage}`
            });

            // Re-throw the error for the caller (CodeProcessor)
            throw error;
        }
    }

    // --- NEW: getResponseTextFromAI (Raw text retrieval, no logging/mutation) ---
    /**
     * Gets a raw text response from the AI model for a given set of messages.
     * This method does NOT log the request/response to the conversation file
     * and does NOT modify any Conversation object. It's intended for
     * intermediate steps like analysis or generation where the output needs parsing.
     * @param messages The array of messages to send to the model.
     * @returns A promise that resolves with the raw text response from the AI.
     * @throws Re-throws any error encountered during the AI call.
     */
    async getResponseTextFromAI(messages: Message[]): Promise<string> {
        console.log(chalk.blue(`Querying AI for intermediate step (using ${this.model.modelName})...`));
        if (!messages || messages.length === 0) {
            console.error(chalk.red("Cannot get raw AI response with empty message history."));
            throw new Error("Cannot get raw AI response with empty message history.");
        }
        // Note: Assumes the 'messages' passed here *already* include any necessary context
        // (e.g., manually constructed prompts for consolidation steps).

        try {
            // Call the underlying model directly with the provided messages
            // Assumes the model's getResponseFromAI method accepts Message[]
            const responseText = await this.model.getResponseFromAI(messages);
            console.log(chalk.blue(`Received raw response (Length: ${responseText.length})`));
            return responseText;

        } catch (error) {
            // Log the error locally for immediate feedback, but don't log to conversation file.
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red("Error getting raw response from AI model:"), errorMessage);
            // Re-throw the error so the caller (e.g., CodeProcessor's analysis/generation steps) can handle it.
            throw error;
        }
    }
    // --- End New Method ---
}

export { AIClient, LogEntry, LogEntryData }; // Export necessary types