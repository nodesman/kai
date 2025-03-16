// lib/AIClient.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { FileSystem } from './FileSystem.js';

class AIClient {
    constructor(config) {
        this.config = config;
        this.genAI = new GoogleGenerativeAI(this.config.get('gemini').api_key);
        this.model = this.genAI.getGenerativeModel({ model: this.config.get('gemini').model_name });
        this.conversationLogFile = path.join(process.cwd(), 'conversation_log.jsonl'); //Outside the package
        this.fs = new FileSystem(); // Initialize fs here
    }

    async logConversation(data) {
        await this.fs.writeFile(this.conversationLogFile, JSON.stringify(data) + '\n', { flag: 'a' });
    }

    async getResponseFromAI(prompt) {

        const chat = this.model.startChat({
            history: prompt, // Use history for chat
            generationConfig: {
                maxOutputTokens: this.config.get('gemini').max_output_tokens,
                temperature: this.config.get('gemini').temperature,
                topP: this.config.get('gemini').top_p,
                topK: this.config.get('gemini').top_k,
            },
        });
        const msg = prompt[prompt.length - 1].parts[0].text;
        let fullResponse = "";
        try {
            await this.logConversation({ type: 'request', prompt }); // Await log
            const result = await chat.sendMessageStream(msg);
            let currentResponse = "";

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                currentResponse += chunkText;
            }
            await this.logConversation({ type: 'response', response: currentResponse }); // Await log
            fullResponse += currentResponse;
            return fullResponse;
        }
        catch (error) {
            console.error("Error communicating with AI:", error);
            await this.logConversation({ type: 'error', error: error.message }); // Await log
            return "";
        }
    }

    extractFilePathsFromDiff(diffContent) {
        const filePaths = [];
        const lines = diffContent.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('--- a/') && lines[i + 1]?.startsWith('+++ b/')) {
                const filePath = lines[i + 1].substring('+++ b/'.length);
                filePaths.push(filePath);
            }
        }
        return filePaths;
    }

}

export { AIClient };