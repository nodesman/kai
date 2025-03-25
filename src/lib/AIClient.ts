// lib/AIClient.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import Gemini2ProModel from "./models/Gemini2ProModel";
import GPT4oMiniModel from './models/GPT4oMiniModel';
import { Config } from "./Config";
import { Conversation } from "./models/Conversation";

interface LogEntryBase {
    type: string;
}

interface RequestLogEntry extends LogEntryBase {
    type: 'request';
    prompt: string;
    conversationId: string;
    modelName: string;
}

interface ResponseLogEntry extends LogEntryBase {
    type: 'response';
    response: string;
    conversationId: string;
    modelName: string;
}

interface ErrorLogEntry extends LogEntryBase {
    type: 'error';
    error: string;
    conversationId: string;
    modelName: string;
}

type LogEntry = RequestLogEntry | ResponseLogEntry | ErrorLogEntry;

class AIClient {
    conversationLogFile: string;
    fs: FileSystem;
    gemini2ProModel: Gemini2ProModel;
    gpt4oMiniModel: GPT4oMiniModel;

    constructor(config: Config) {
        this.gemini2ProModel = new Gemini2ProModel(config);
        this.gpt4oMiniModel = new GPT4oMiniModel(config);
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

    async getResponseFromAI(conversation: Conversation, modelName: string = "gemini-2.0-flash"): Promise<string> {
        try {
            const conversationId = conversation.getId();
            const prompt = conversation.getLastMessage()?.content || "";
            await this.logConversation({ type: 'request', prompt, conversationId, modelName });

            let response = "";
            if (modelName === "gemini-2.0-flash") {
                response = await this.gemini2ProModel.getResponseFromAI(conversation);
            } else if (modelName === "gpt-4o-mini") {
                response = await this.gpt4oMiniModel.getResponseFromAI(conversation);
            } else {
                throw new Error(`Unsupported model: ${modelName}`);
            }

            await this.logConversation({ type: 'response', response, conversationId, modelName });
            return response;

        } catch (error) {
            const conversationId = conversation.getId();
            console.error("Error in AIClient:", error);
            await this.logConversation({ type: 'error', error: (error as Error).message, conversationId, modelName:"Unknown" }); // Log error with model name.
            return ""; // Or re-throw, depending on how you want to handle it higher up
        }
    }
}

export { AIClient };