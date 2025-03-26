// File: src/lib/AIClient.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import Gemini2ProModel from "./models/Gemini2ProModel";
import { Config } from "./Config";
import Conversation, { Message } from "./models/Conversation"; // Import Conversation and Message

// Keep LogEntry types as they are, they define the JSONL structure
interface LogEntryBase {
    type: string;
    timestamp: string; // Ensure timestamp is part of the base
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

interface ErrorLogEntry extends LogEntryBase {
    type: 'error';
    error: string;
}

type LogEntry = RequestLogEntry | ResponseLogEntry | ErrorLogEntry;

// Define the type for the data passed to logConversation more explicitly
type LogEntryData =
    | Omit<RequestLogEntry, 'timestamp'>
    | Omit<ResponseLogEntry, 'timestamp'>
    | Omit<ErrorLogEntry, 'timestamp'>;


class AIClient {
    fs: FileSystem;
    model: Gemini2ProModel;
    config: Config;

    constructor(config: Config) {
        this.config = config;
        this.model = new Gemini2ProModel(config);
        this.fs = new FileSystem();
    }

    // Use the more explicit LogEntryData type for the parameter
    async logConversation(conversationFilePath: string, entryData: LogEntryData): Promise<void> {
        const timestamp = new Date().toISOString();
        // Cast to LogEntry after adding timestamp - TS should infer correctly now
        const logData: LogEntry = { ...entryData, timestamp };

        try {
            await this.fs.appendJsonlFile(conversationFilePath, logData);
        } catch (err) {
            console.error(`Error writing to log file ${conversationFilePath}:`, err);
        }
    }

    async getResponseFromAI(conversation: Conversation, conversationFilePath: string): Promise<string> {
        const lastUserMessage = conversation.getLastMessage();
        if (!lastUserMessage || lastUserMessage.role !== 'user') {
            throw new Error("Conversation history must end with a user message.");
        }

        try {
            // Log the user request - this should now type-check correctly
            await this.logConversation(conversationFilePath, {
                type: 'request',
                role: 'user', // This property is valid on RequestLogEntry
                content: lastUserMessage.content
            });

            const responseText = await this.model.getResponseFromAI(conversation);

            // Log the AI response - this should now type-check correctly
            await this.logConversation(conversationFilePath, {
                type: 'response',
                role: 'assistant', // This property is valid on ResponseLogEntry
                content: responseText
            });

            conversation.addMessage('assistant', responseText);

            return responseText;
        } catch (error) {
            console.error("Error getting response from AI:", error);
            // Log the error - this should now type-check correctly
            await this.logConversation(conversationFilePath, {
                type: 'error',
                error: (error as Error).message // This property is valid on ErrorLogEntry
            });
            throw error;
        }
    }
}

export { AIClient, LogEntry }; // Export LogEntry if needed elsewhere