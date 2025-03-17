// lib/AIClient.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import Gemini2ProModel, { GeminiConfig } from "./models/Gemini2ProModel";
import {Config} from "./Config"; // Only import Gemini2ProModel
// import Models from "./models/modelsEnum"; // Not used, so commented out.  Good practice to remove unused imports.

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
    conversationLogFile: string; // Property declaration
    fs: FileSystem;              // Property declaration
    model: Gemini2ProModel;       // Property declaration:  Good! We know the exact type.

    constructor(config: Config) { // Type annotation for config!
        this.model = new Gemini2ProModel(config); // Hardcoded Gemini2ProModel
        this.conversationLogFile = path.join(process.cwd(), 'conversation_log.jsonl');
        this.fs = new FileSystem();
    }

    async logConversation(entry: LogEntry): Promise<void> {  // Type annotation!
        const timestamp = new Date().toISOString();
        const logData = { ...entry, timestamp }; // Add timestamp to the entry

        try {
            await this.fs.writeFile(
                this.conversationLogFile,
                JSON.stringify(logData) + '\n',
            );
        } catch (err) {
            console.error("Error writing to log file:", err);
        }
    }

    async getResponseFromAI(prompt: string) : Promise<string> { // Type annotation + Return type!
        try {
            //Typo fix gisation to logConversation
            await this.logConversation({ type: 'request', prompt });
            const response = await this.model.getResponseFromAI(prompt);
            await this.logConversation({ type: 'response', response });
            return response;
        } catch (error) {
            console.error("Error in AIClient:", error);
            // Correctly handle the 'unknown' type of error.
            await this.logConversation({ type: 'error', error: (error as Error).message });
            return ""; //  Consider returning a more meaningful value or throwing an error
        }
    }
}

export { AIClient };