// lib/models/Gemini2ProModel.ts
import BaseModel from "./BaseModel";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Config } from "../Config";
import { Conversation, Message } from "./Conversation"; // Import Conversation

// Gemini-specific types (keep these for internal use)
interface GeminiMessagePart {
    text: string;
}

interface GeminiMessage {
    role: "user" | "model";
    parts: GeminiMessagePart[];
}

interface GeminiChatHistory extends Array<GeminiMessage> {}

class Gemini2ProModel extends BaseModel {
    genAI: GoogleGenerativeAI;
    modelName: string;
    model: any; // Ideally, this should be a more specific type from the Gemini API

    constructor(config: Config) {
        super(config);
        this.genAI = new GoogleGenerativeAI(config.gemini.api_key);
        this.modelName = "gemini-2.0-flash";
        this.model = this.genAI.getGenerativeModel({ model: this.modelName });
    }

    async getResponseFromAI(conversation: Conversation): Promise<string> { // Accepts Conversation ONLY
        const geminiConversation = this.convertToGeminiConversation(conversation.getMessages());
        return this.queryGemini(geminiConversation);
    }

    async queryGemini(conversation: GeminiChatHistory): Promise<string> {

        try {
            const generationConfig = {
                temperature: 1,
                topP: 0.95,
                topK: 64,
                maxOutputTokens: 8192,
            };

            const chatSession = this.model.startChat({
                history: conversation,
                generationConfig,
            });

            // Get the last message (which *must* be from the user)
            const lastMessage = conversation[conversation.length - 1];

            if (!lastMessage || lastMessage.role !== "user") {
                console.error("❌ Error: The last message in the conversation must be from the user.");
                throw new Error("The last message in the conversation must be from the user.");
            }

            const lastMessageText = lastMessage.parts.map(part => part.text).join('');

            // Use sendMessageStream with the *last message's text*
            const result = await chatSession.sendMessageStream(lastMessageText);
            let assistantMessage = "";
            for await (const chunk of result.stream) {
                assistantMessage += chunk.text();
            }

            return assistantMessage;

        } catch (error) {
            this.handleError(error); // handleError already throws, so this is sufficient.
            // We don't need an explicit return here anymore, as handleError *always* throws.
            return '';
        }
    }

    convertToGeminiConversation(messages: Message[]): GeminiChatHistory {
        return messages.map(msg => {
            if (!msg.role || !msg.content) {
                console.warn("Skipping invalid message:", msg);
                return null;
            }

            return {
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }],
            };
        }).filter(msg => msg !== null) as GeminiChatHistory;
    }

    flattenMessages(conversation: any): any[] { // No longer needed, but kept for potential future use
        return conversation.messages
            .flatMap((entry: any) => entry.messages ?? [entry])
            .filter((msg: any) => msg.role && msg.content);
    }

    handleError(error: any): void {
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