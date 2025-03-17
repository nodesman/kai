// lib/models/Gemini2ProModel.ts
import BaseModel from "./BaseModel";  // Corrected import
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { Config } from "../Config"; // Import Config


export interface GeminiConfig {
    api_key: string;
}

class Gemini2ProModel extends BaseModel {
    genAI: GoogleGenerativeAI;
    modelName: string;
    model: any; // Ideally, this should be a more specific type from the Gemini API

    constructor(config: Config) {
        super(config);
        this.genAI = new GoogleGenerativeAI(config.gemini.api_key);
        this.modelName = "gemini-2.0-pro-exp-02-05";
        this.model = this.genAI.getGenerativeModel({ model: this.modelName });
    }

    async getResponseFromAI(conversation: any): Promise<string> { // Added type for conversation
        return this.queryGemini(conversation);
    }

    async queryGemini(conversation: any): Promise<string> {  // Added type, return Promise<string>
        console.log("Querying gemini")
        return "";
        // try {
//             // const flattenedMessages = this.flattenMessages(conversation);
//
//             // Prepare chat history
//             const chatHistory = conversation.map(msg => ({
//                 type: msg.role === 'assistant' ? 'model' : 'user',
//                 parts: [{ text: msg.content }],
//             })).slice(0, -1); // all except the last one
//
//             if (chatHistory.length === 0 || chatHistory[0].role !== 'user') {
//                 console.error("❌ Error: Gemini requires the first message to be from the user.");
//                 return;
//             }
//
//             const generationConfig = {
//                 temperature: 1,
//                 topP: 0.95,
//                 topK: 64,
//                 maxOutputTokens: 8192,
//             };
// x
//             const chatSession = this.model.startChat({
//                 history: chatHistory,
//                 generationConfig,
//             });
//             // Use sendMessageStream here:
//             const result = await chatSession.sendMessageStream(chatHistory);
//             let assistantMessage = "";
//             for await (const chunk of result.stream) {
//                 assistantMessage += chunk.text();
//             }
//
//             conversation.messages.push({ role: 'assistant', content: assistantMessage });
//             return assistantMessage;
//
//         } catch (error) {
//             this.handleError(error);
//         }
    }
    flattenMessages(conversation: any): any[] { // Added types
        return conversation.messages
            .flatMap((entry: any) => entry.messages ?? [entry])
            .filter((msg: any) => msg.role && msg.content)
    }
    handleError(error: any): void { // Added type and return type
        let errorMessage = "An error occurred while making the AI API request.";

        if (error.response) {
            errorMessage += `\n❌ HTTP Status: ${error.response.status}`;
            errorMessage += `\n📌 AI Error Message: ${JSON.stringify(error.response.data, null, 2)}`;
        } else if (error.request) {
            errorMessage += `\n⏳ No response received. Possible network issues or server timeout.`;
        } else if (error.message) {
            errorMessage += `\n⚠️ Error: ${error.message}`;
        } else {
            errorMessage += `\n⚠️ An unexpected error occurred.`;
        }

        console.error(errorMessage);
        throw new Error(errorMessage);
    }
}

export default Gemini2ProModel;