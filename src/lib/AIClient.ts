// lib/AIClient.js
import path from 'path';
import { FileSystem } from './FileSystem.ts';
import Gemini2ProModel from "./models/Gemini2ProModel"; // Only import Gemini2ProModel
import Models from "./models/modelsEnum";

class AIClient {
    constructor(config) {
        this.model = new Gemini2ProModel(config); // Hardcoded Gemini2ProModel
        this.conversationLogFile = path.join(process.cwd(), 'conversation_log.jsonl');
        this.fs = new FileSystem();
    }

    async logConversation(data) {
        await this.fs.writeFile(this.conversationLogFile, JSON.stringify(data) + '\n', { flag: 'a' });
    }

    async getResponseFromAI(prompt) {
        try {
            await this.logConversation({ type: 'request', prompt });
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
