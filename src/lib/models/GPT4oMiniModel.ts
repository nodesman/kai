// src/lib/models/GPT4oMiniModel.ts

import BaseModel from "./BaseModel";
import { OpenAI } from "openai"; // Import OpenAI
import { Config } from "../Config";
import { Conversation, Message } from "./Conversation";

interface OpenAIMessage {  //Interface to convert back to OPENAI message format.
    role: "user" | "assistant" | "system";
    content: string;
}

class GPT4oMiniModel extends BaseModel {
    openai: OpenAI;
    modelName: string;

    constructor(config: Config) {
        super(config);
        //This requires an OPENAI Key in the config, not Gemini, if the model name is GPT4oMini.  This can be handled in Config.ts
        this.openai = new OpenAI({ apiKey: config.openai.api_key});  // Assumes API key is in config
        this.modelName = "gpt-4o-mini";
    }

    async getResponseFromAI(conversation: Conversation): Promise<string> {
        const openaiMessages: OpenAIMessage[] = this.convertToOpenAIMessages(conversation.getMessages());
        return this.queryOpenAI(openaiMessages);
    }

    convertToOpenAIMessages(messages: Message[]): OpenAIMessage[] {
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    async queryOpenAI(messages: OpenAIMessage[]): Promise<string> {
        try {
            const completion = await this.openai.chat.completions.create({
                model: this.modelName,
                messages: messages,
            });
            return completion.choices[0].message.content || "";
        } catch (error: any) {
            //Improved error handling.
            let errorMessage = "An error occurred while calling the OpenAI API.";
            if (error.response) {
                // The request was made and the server responded with a status code
                // that falls out of the range of 2xx
                errorMessage += `\n❌ HTTP Status: ${error.response.status}`;
                errorMessage += `\n📌 OpenAI Error Message: ${JSON.stringify(error.response.data, null, 2)}`;
            } else if (error.request) {
                // The request was made but no response was received
                errorMessage += `\n⏳ No response received. Possible network issues or server timeout.`;
            } else {
                // Something happened in setting up the request that triggered an Error
                errorMessage += `\n⚠️ Error: ${error.message}`;
            }
            console.error(errorMessage);
            throw new Error(errorMessage);  //Re-throwing
        }
    }
}

export default GPT4oMiniModel;
