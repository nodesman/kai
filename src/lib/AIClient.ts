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

// --- Import necessary types from @google/generative-ai ---
import {
    GenerateContentRequest,
    GenerateContentResult,
    Tool,
    FunctionDeclaration, // To help type the tool definition
    // Content is also used internally by models
} from "@google/generative-ai";
// --- End Import ---


// LogEntry Types (Defined and exported directly) - Unchanged
interface LogEntryBase { type: string; timestamp: string; }
interface RequestLogEntry extends LogEntryBase { type: 'request'; role: 'user'; content: string; }
interface ResponseLogEntry extends LogEntryBase { type: 'response'; role: 'assistant'; content: string; }
interface SystemLogEntry extends LogEntryBase { type: 'system'; role: 'system'; content: string; }
interface ErrorLogEntry extends LogEntryBase { type: 'error'; error: string; role?: 'system' | 'user' | 'assistant'; }
export type LogEntry = RequestLogEntry | ResponseLogEntry | ErrorLogEntry | SystemLogEntry; // Exported type
export type LogEntryData = Omit<RequestLogEntry, 'timestamp'> | Omit<ResponseLogEntry, 'timestamp'> | Omit<ErrorLogEntry, 'timestamp'> | Omit<SystemLogEntry, 'timestamp'>; // Exported type

class AIClient {
    fs: FileSystem;
    private proModel: Gemini2ProModel;
    private flashModel: Gemini2FlashModel;
    config: Config;

    constructor(config: Config) {
        this.config = config;
        this.proModel = new Gemini2ProModel(config);
        this.flashModel = new Gemini2FlashModel(config);
        this.fs = new FileSystem();
    }

    private countTokens(text: string): number {
        return gpt3Encode(text).length;
    }

    async logConversation(conversationFilePath: string, entryData: LogEntryData): Promise<void> {
        // Unchanged
        const timestamp = new Date().toISOString();
        const logData: LogEntry = { ...entryData, timestamp } as LogEntry;
        try { await this.fs.appendJsonlFile(conversationFilePath, logData); }
        catch (err) { console.error(chalk.red(`Error writing log file ${conversationFilePath}:`), err); }
    }

    // --- getResponseFromAI (for standard chat) --- Unchanged
    async getResponseFromAI(
        conversation: Conversation,
        conversationFilePath: string,
        contextString?: string,
        useFlashModel: boolean = false
    ): Promise<void> {
        // ... (Implementation remains the same as before) ...
        const messages = conversation.getMessages();
        const lastMessage = messages[messages.length - 1];

        if (!lastMessage || lastMessage.role !== 'user') {
            console.error(chalk.red("Conversation history doesn't end with a user message. Aborting AI call."));
            await this.logConversation(conversationFilePath, { type: 'error', error: "Internal error: Conversation history doesn't end with a user message." });
            throw new Error("Conversation history must end with a user message to get AI response.");
        }

        await this.logConversation(conversationFilePath, { type: 'request', role: 'user', content: lastMessage.content });

        let messagesForModel: Message[];
        if (contextString && contextString.length > "Code Base Context:\n".length) {
            const contextTokenCount = this.countTokens(contextString);
            console.log(chalk.magenta(`Prepending context (${contextTokenCount} tokens)...`));
            const finalUserPromptText = `This is the code base context:\n${contextString}\n\n---\nUser Question:\n${lastMessage.content}`;
            messagesForModel = [ ...messages.slice(0, -1), { ...lastMessage, content: finalUserPromptText } ];
        } else {
            messagesForModel = messages;
            console.log(chalk.gray("No context string provided or context is empty."));
        }

        const modelToCall = useFlashModel ? this.flashModel : this.proModel;
        const modelLogName = useFlashModel ? this.flashModel.modelName : this.proModel.modelName;
        console.log(chalk.blue(`Selecting model instance: ${modelLogName}`));

        try {
            // Use the getResponseFromAI method of the model instance (designed for chat)
            const responseText = await modelToCall.getResponseFromAI(messagesForModel);

            await this.logConversation(conversationFilePath, { type: 'response', role: 'assistant', content: responseText });
            conversation.addMessage('assistant', responseText);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`Error getting response from AI model (${modelLogName}):`), errorMessage);
            await this.logConversation(conversationFilePath, { type: 'error', error: `AI Model Error (${modelLogName}): ${errorMessage}` });
            throw error;
        }
    }

    // --- getResponseTextFromAI (for simple text generation) --- Unchanged
    async getResponseTextFromAI(
        messages: Message[],
        useFlashModel: boolean = false
    ): Promise<string> {
        // ... (Implementation remains the same as before) ...
        if (!messages || messages.length === 0) {
            console.error(chalk.red("Cannot get raw AI response with empty message history."));
            throw new Error("Cannot get raw AI response with empty message history.");
        }

        const modelToCall = useFlashModel ? this.flashModel : this.proModel;
        const modelLogName = useFlashModel ? this.flashModel.modelName : this.proModel.modelName;
        console.log(chalk.blue(`Querying AI for intermediate step (using ${modelLogName})...`));

        try {
            // This method in the model should still just return text
            const responseText = await modelToCall.getResponseFromAI(messages);

            console.log(chalk.blue(`Received raw response (Length: ${responseText.length})`));
            return responseText;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`Error getting raw response from AI model (${modelLogName}):`), errorMessage);
            throw error;
        }
    }

    // --- *** NEW: generateContent (Handles Function Calling) *** ---
    async generateContent(
        request: GenerateContentRequest, // Use the SDK's request type
        useFlashModel: boolean = false
    ): Promise<GenerateContentResult> { // Return the SDK's result type

        const modelToCall = useFlashModel ? this.flashModel : this.proModel;
        const modelLogName = useFlashModel ? this.flashModel.modelName : this.proModel.modelName;
        console.log(chalk.blue(`Generating content (potentially with function calls) using ${modelLogName}...`));

        try {
            // Delegate to the model's new generateContent method
            const result = await modelToCall.generateContent(request);

            // Optional: Log details about the response (text vs function call)
            const response = result.response;
            const firstCandidate = response?.candidates?.[0];
            if (firstCandidate?.content?.parts?.[0]?.functionCall) {
                const fc = firstCandidate.content.parts[0].functionCall;
                console.log(chalk.green(`Received function call: ${fc.name} with args: ${JSON.stringify(fc.args)}`));
            } else if (firstCandidate?.content?.parts?.[0]?.text) {
                const text = firstCandidate.content.parts[0].text;
                console.log(chalk.blue(`Received text response (Length: ${text.length})`));
            } else {
                console.log(chalk.yellow(`Received response with no function call or text.`));
                // Consider logging the finishReason if available: response?.candidates?.[0]?.finishReason
            }

            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Log error including the specific model used
            console.error(chalk.red(`Error generating content with AI model (${modelLogName}):`), errorMessage);
            // We might not have a conversation context here easily, log generally or rethrow
            throw error; // Re-throw
        }
    }
    // --- *** END NEW METHOD *** ---
}

// Export the FunctionDeclaration type if needed elsewhere, or define tool within CodeProcessor
export { AIClient, FunctionDeclaration }; // Export FunctionDeclaration for typing the tool