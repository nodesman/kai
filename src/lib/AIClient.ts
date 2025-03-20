// lib/AIClient.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import Gemini2ProModel from "./models/Gemini2ProModel";
import {Config} from "./Config";
import Conversation from "./models/Conversation"; // Import Conversation

interface LogEntryBase {
    type: string; // Common field for all log entries
}

interface RequestLogEntry extends LogEntryBase {
    type: 'request';
    prompt: string;
    conversationId: string; // Add conversationId for logging
}

interface ResponseLogEntry extends LogEntryBase {
    type: 'response';
    response: string;
    conversationId: string; // Add conversationId for logging
}

interface ErrorLogEntry extends LogEntryBase {
    type: 'error';
    error: string;
    conversationId: string; // Add conversationId for logging
}

// Union type:  A log entry can be one of these types
type LogEntry = RequestLogEntry | ResponseLogEntry | ErrorLogEntry;

class AIClient {
    conversationLogFile: string;
    fs: FileSystem;
    model: Gemini2ProModel;

    constructor(config: Config) {
        this.model = new Gemini2ProModel(config);
        this.conversationLogFile = path.join(process.cwd(), 'conversation_log.jsonl');
        this.fs = new FileSystem();
    }

    async logConversation(entry: LogEntry): Promise<void> {
        const timestamp = new Date().toISOString();
        const logData = { ...entry, timestamp };

        try {
            await this.fs.writeFile(
                this.conversationLogFile,
                JSON.stringify(logData) + '\n',
            );
        } catch (err) {
            console.error("Error writing to log file:", err);
        }
    }

    async getResponseFromAI(conversation: Conversation, conversationId: string): Promise<string> {
        try {
            // Log the request (using the new conversation format)
            await this.logConversation({ type: 'request', prompt: conversation.getLastMessage()?.content || "", conversationId });

            // Pass the Conversation object to the model's getResponseFromAI
            const response = await this.model.getResponseFromAI(conversation);

            // Log the response
            await this.logConversation({ type: 'response', response, conversationId });

            return response;
        } catch (error) {
            console.error("Error in AIClient:", error);
            await this.logConversation({ type: 'error', error: (error as Error).message, conversationId });
            return ""; // Or throw the error, depending on your error handling strategy
        }
    }
}

export { AIClient };