// File: src/lib/AIClient.ts
import path from 'path';
import { FileSystem } from './FileSystem';
// Import BOTH model classes
import Gemini2ProModel from "./models/Gemini2ProModel";
import Gemini2FlashModel from "./models/Gemini2FlashModel"; // Added Flash model
// Import Config class itself
import { Config } from "./Config";
import Conversation, { Message } from "./models/Conversation";
import chalk from 'chalk';
import { encode as gpt3Encode } from 'gpt-3-encoder';

// LogEntry Types (Defined and exported directly)
interface LogEntryBase { type: string; timestamp: string; }
interface RequestLogEntry extends LogEntryBase { type: 'request'; role: 'user'; content: string; }
interface ResponseLogEntry extends LogEntryBase { type: 'response'; role: 'assistant'; content: string; }
interface SystemLogEntry extends LogEntryBase { type: 'system'; role: 'system'; content: string; }
interface ErrorLogEntry extends LogEntryBase { type: 'error'; error: string; role?: 'system' | 'user' | 'assistant'; }
export type LogEntry = RequestLogEntry | ResponseLogEntry | ErrorLogEntry | SystemLogEntry; // Exported type
export type LogEntryData = Omit<RequestLogEntry, 'timestamp'> | Omit<ResponseLogEntry, 'timestamp'> | Omit<ErrorLogEntry, 'timestamp'> | Omit<SystemLogEntry, 'timestamp'>; // Exported type

class AIClient {
    fs: FileSystem;
    // --- Store instances of BOTH models ---
    private proModel: Gemini2ProModel; // For initial/primary requests
    private flashModel: Gemini2FlashModel; // For subsequent/secondary requests
    config: Config;

    constructor(config: Config) {
        this.config = config;
        // Instantiate BOTH model classes with the config
        this.proModel = new Gemini2ProModel(config);
        this.flashModel = new Gemini2FlashModel(config); // Instantiate Flash model
        this.fs = new FileSystem();
    }

    private countTokens(text: string): number {
        return gpt3Encode(text).length;
    }

    async logConversation(conversationFilePath: string, entryData: LogEntryData): Promise<void> {
        const timestamp = new Date().toISOString();
        const logData: LogEntry = { ...entryData, timestamp } as LogEntry;
        try { await this.fs.appendJsonlFile(conversationFilePath, logData); }
        catch (err) { console.error(chalk.red(`Error writing log file ${conversationFilePath}:`), err); }
    }

    // --- getResponseFromAI (Accepts useFlashModel flag) ---
    async getResponseFromAI(
        conversation: Conversation,
        conversationFilePath: string,
        contextString?: string,
        useFlashModel: boolean = false // Flag to choose model, defaults to Pro
    ): Promise<void> {

        const messages = conversation.getMessages();
        const lastMessage = messages[messages.length - 1];

        if (!lastMessage || lastMessage.role !== 'user') { /* Error handling unchanged */
            console.error(chalk.red("Conversation history doesn't end with a user message. Aborting AI call."));
            await this.logConversation(conversationFilePath, { type: 'error', error: "Internal error: Conversation history doesn't end with a user message." });
            throw new Error("Conversation history must end with a user message to get AI response.");
        }

        await this.logConversation(conversationFilePath, { type: 'request', role: 'user', content: lastMessage.content });

        let messagesForModel: Message[];
        if (contextString && contextString.length > "Code Base Context:\n".length) { /* Context prepending unchanged */
            const contextTokenCount = this.countTokens(contextString);
            console.log(chalk.magenta(`Prepending context (${contextTokenCount} tokens)...`));
            // Simple concatenation for context - adjust if needed
            const finalUserPromptText = `This is the code base context:\n${contextString}\n\n---\nUser Question:\n${lastMessage.content}`;
            messagesForModel = [ ...messages.slice(0, -1), { ...lastMessage, content: finalUserPromptText } ];
        } else {
            messagesForModel = messages;
            console.log(chalk.gray("No context string provided or context is empty."));
        }

        // Choose which model instance to call
        const modelToCall = useFlashModel ? this.flashModel : this.proModel;
        const modelLogName = useFlashModel ? this.flashModel.modelName : this.proModel.modelName;
        console.log(chalk.blue(`Selecting model instance: ${modelLogName}`));

        try {
            // Call the chosen model instance's method
            const responseText = await modelToCall.getResponseFromAI(messagesForModel);

            // Log response
            await this.logConversation(conversationFilePath, { type: 'response', role: 'assistant', content: responseText });

            // Mutate conversation
            conversation.addMessage('assistant', responseText);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Log error including the specific model used
            console.error(chalk.red(`Error getting response from AI model (${modelLogName}):`), errorMessage);
            await this.logConversation(conversationFilePath, { type: 'error', error: `AI Model Error (${modelLogName}): ${errorMessage}` });
            throw error; // Re-throw
        }
    }

    // --- getResponseTextFromAI (Accepts useFlashModel flag) ---
    async getResponseTextFromAI(
        messages: Message[],
        useFlashModel: boolean = false // Flag to choose model, defaults to Pro
    ): Promise<string> {

        if (!messages || messages.length === 0) {
            console.error(chalk.red("Cannot get raw AI response with empty message history."));
            throw new Error("Cannot get raw AI response with empty message history.");
        }

        // Choose which model instance to call
        const modelToCall = useFlashModel ? this.flashModel : this.proModel;
        const modelLogName = useFlashModel ? this.flashModel.modelName : this.proModel.modelName;
        console.log(chalk.blue(`Querying AI for intermediate step (using ${modelLogName})...`));

        try {
            // Call the chosen model instance's method
            const responseText = await modelToCall.getResponseFromAI(messages);

            console.log(chalk.blue(`Received raw response (Length: ${responseText.length})`));
            return responseText;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Log error including the specific model used
            console.error(chalk.red(`Error getting raw response from AI model (${modelLogName}):`), errorMessage);
            throw error; // Re-throw
        }
    }
}

// *** CORRECTED: Only export the class here, types are exported above ***
export { AIClient };