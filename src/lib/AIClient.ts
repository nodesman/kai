// lib/AIClient.js
import path from 'path';
import { FileSystem } from './FileSystem.ts';
import Gemini2ProModel from "./models/Gemini2ProModel"; // Only import Gemini2ProModel
import Models from "./models/modelsEnum";

// In lib/AIClient.ts (or a separate types.ts file if you prefer)

interface LogEntryBase {
    type: string; // Common field for all log entries
}

interface RequestLogEntry extends LogEntryBase {
    type: 'request';
    prompt: string;
}

interface ResponseLogEntry extends LogEntryBase {
    type: 'response';
    response: string;
}

interface ErrorLogEntry extends LogEntryBase {
    type: 'error';
    error: string;
}

// Union type:  A log entry can be one of these types
type LogEntry = RequestLogEntry | ResponseLogEntry | ErrorLogEntry;

class AIClient {
    constructor(config) {
        this.model = new Gemini2ProModel(config); // Hardcoded Gemini2ProModel
        this.conversationLogFile = path.join(process.cwd(), 'conversation_log.jsonl');
        this.fs = new FileSystem();
    }

    async logConversation(entry: LogEntry) {
        const timestamp = new Date().toISOString();
        const logData = { ...entry, timestamp }; // Add timestamp to the entry

        try {
            await this.fs.writeFile(
                this.conversationLogFile,
                JSON.stringify(logData) + '\n',
                { flag: 'a' }
            );
        } catch (err) {
            //Handle file writing errors appropriately.
            console.error("Error writing to log file:", err);
        }
    }

    async getResponseFromAI(prompt) {
        try {
            await this.gisation({ type: 'request', prompt });
            const response = await this.model.getResponseFromAI(prompt);
            await this.logConversation({ type: 'response', response });
            return response;
        } catch (error) {
            console.error("Error in AIClient:", error);
            await this.logConversation({ type: 'error', error: error.message });
            return "";
        }
    }
}

export { AIClient };
