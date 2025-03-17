// lib/AIClient.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import Gemini2ProModel from "./models/Gemini2ProModel";
import {Config} from "./Config";
import Conversation from "./models/Conversation"; // Only import Gemini2ProModel
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

    async getResponseFromAI(prompt: string): Promise<string> {
        try {
            // Create a new Conversation object for this single prompt
            const conversation = new Conversation();
            conversation.addMessage('user', prompt);

            // Log the request (using the new conversation format)
            await this.logConversation({ type: 'request', prompt });

            // Pass the Conversation object to the model's getResponseFromAI
            const response = await this.model.getResponseFromAI(conversation);

            // Log the response
            await this.logConversation({ type: 'response', response });

            return response;
        } catch (error) {
            console.error("Error in AIClient:", error);
            await this.logConversation({ type: 'error', error: (error as Error).message });
            return ""; // Or throw the error, depending on your error handling strategy
        }
    }
}

export { AIClient };