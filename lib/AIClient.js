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
    async getDiffFromAI(initialPrompt, userPrompt) { //pass down userPrompt

        const chat = this.model.startChat({
            history: initialPrompt, // Use history for chat
            generationConfig: {
                maxOutputTokens: this.config.get('gemini').max_output_tokens,
                temperature: this.config.get('gemini').temperature,
                topP: this.config.get('gemini').top_p,
                topK: this.config.get('gemini').top_k,
            },
        });
        const msg = "Please tell me the code changes to be made to incorporate the following changes: `" + userPrompt + "` Provide the change only as a diff, and make sure the diff includes the correct file paths relative to the project root.  If you have a lot of diff to suggest, please indicate the list of files impacted so that I can detect if we have all the changes from you and if not, request them from you through multiple requests.\n"

        let fullResponse = "";
        let filesImpacted = new Set();
        let prompt = msg;

        try {
            do {
                await this.logConversation({ type: 'request', prompt }); // Await

                const result = await chat.sendMessageStream(prompt);
                let currentResponse = "";

                for await (const chunk of result.stream) {
                    const chunkText = chunk.text();
                    currentResponse += chunkText;
                }

                await this.logConversation({ type: 'response', response: currentResponse }); // Await
                fullResponse += currentResponse;

                // Simplified diff extraction and file identification
                const diffRegex = /`diff\n([\s\S]*?)\n`/g;
                let diffMatch;
                while ((diffMatch = diffRegex.exec(currentResponse)) !== null) {
                    const diffContent = diffMatch[1];
                    const filePaths = this.extractFilePathsFromDiff(diffContent);
                    filePaths.forEach(file => filesImpacted.add(file));
                }

                if (filesImpacted.size > 0 && currentResponse.includes("```diff")) {
                    prompt = "Please continue with the rest of the diff. You have provided diffs for the following files so far: " + [...filesImpacted].join(", ");
                    console.log("Detected potentially incomplete diff. Requesting continuation...");
                } else if (currentResponse.trim().length > 0 && !currentResponse.includes("```diff")) {
                    console.log("AI Response (no diff in this chunk):");
                    console.log(currentResponse);
                    prompt = null; // Stop if no diff and not asking for continuation.
                }
                else {
                    prompt = null;
                }


                if (prompt) {
                    let remainingTime = (60 * 1000) / this.config.get('gemini').rate_limit.requests_per_minute + 1000;
                    while (remainingTime > 0) {
                        process.stdout.write(`Waiting ${Math.ceil(remainingTime / 1000)} seconds before next request...\r`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        remainingTime -= 1000;
                    }
                    process.stdout.write('\n'); //clear the line
                }

            } while (prompt);

            return { diff: fullResponse, filesImpacted: [...filesImpacted] }; // Return as array
        } catch (error) {
            console.error("Error communicating with AI:", error);
            await this.logConversation({ type: 'error', error: error.message }); // Await log
            return { diff: "", filesImpacted: [] };
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