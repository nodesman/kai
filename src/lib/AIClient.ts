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
// *** ADDED Import ***
import { HIDDEN_CONVERSATION_INSTRUCTION } from './internal_prompts'; // <-- Import the hidden prompt

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

    // --- getResponseFromAI (for standard chat) --- MODIFIED ---
    async getResponseFromAI(
        conversation: Conversation,
        conversationFilePath: string,
        contextString?: string,
        useFlashModel: boolean = false
    ): Promise<string> { // Adjusted: This method ONLY returns string for chat
        const messages = conversation.getMessages();
        const lastMessage = messages[messages.length - 1];

        if (!lastMessage || lastMessage.role !== 'user') {
            console.error(chalk.red("Conversation history doesn't end with a user message. Aborting AI call."));
            await this.logConversation(conversationFilePath, { type: 'error', error: "Internal error: Conversation history doesn't end with a user message." });
            throw new Error("Conversation history must end with a user message to get AI response.");
        }

        // --- IMPORTANT: Log the ORIGINAL user message BEFORE modifying for the AI call ---
        await this.logConversation(conversationFilePath, { type: 'request', role: 'user', content: lastMessage.content });

        // --- Prepare messages for the AI, including the hidden prompt ---
        let finalUserPromptText = lastMessage.content; // Start with original prompt

        // Prepend context if provided
        if (contextString && contextString.length > "Code Base Context:\n".length) {
            const contextTokenCount = this.countTokens(contextString);
            console.log(chalk.magenta(`Prepending context (${contextTokenCount} tokens)...`));
            finalUserPromptText = `This is the code base context:\n${contextString}\n\n---\nUser Question:\n${finalUserPromptText}`;
        } else {
            console.log(chalk.gray("No context string provided or context is empty."));
        }

        // *** Prepend the hidden instruction ***
        // This instruction is prepended to the final user message text sent to the model.
        // It does NOT get saved back into the Conversation object or logged.
        finalUserPromptText = `${HIDDEN_CONVERSATION_INSTRUCTION}\n\n---\n\n${finalUserPromptText}`;
        console.log(chalk.dim("Prepended hidden conversation instruction (not logged)."));

        // Create the message structure for the model, replacing the last user message content
        const messagesForModel: Message[] = [
            ...messages.slice(0, -1),
            { ...lastMessage, content: finalUserPromptText } // Use the modified final prompt
        ];
        // --- End AI message preparation ---

        const modelToCall = useFlashModel ? this.flashModel : this.proModel;
        const modelLogName = useFlashModel ? this.flashModel.modelName : this.proModel.modelName;
        console.log(chalk.blue(`Selecting model instance for chat: ${modelLogName}`));

        try {
            // Pass the modified messages (with hidden prompt baked in) to the model
            const responseText = await modelToCall.getResponseFromAI(messagesForModel);

            // Log the actual AI response and add it to the conversation *without* the hidden prompt
            await this.logConversation(conversationFilePath, { type: 'response', role: 'assistant', content: responseText });
            conversation.addMessage('assistant', responseText); // Add clean response to conversation
            return responseText; // Return the string

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`Error getting response from AI model (${modelLogName}):`), errorMessage);
            await this.logConversation(conversationFilePath, { type: 'error', error: `AI Model Error (${modelLogName}): ${errorMessage}` });
            throw error;
        }
    }

    // --- getResponseTextFromAI (for simple text generation like consolidation analysis/generation) ---
    // This does NOT automatically prepend the hidden conversation instruction,
    // as it's meant for specific tasks where the prompt is fully constructed by the caller.
    // The ConsolidationGenerator will prepend its specific hidden instruction.
    async getResponseTextFromAI(
        messages: Message[], // Expects caller to format messages correctly
        useFlashModel: boolean = false
    ): Promise<string> {
        // ... (Implementation remains the same - no hidden prompt added here) ...
        if (!messages || messages.length === 0) {
            console.error(chalk.red("Cannot get raw AI response with empty message history."));
            throw new Error("Cannot get raw AI response with empty message history.");
        }

        const modelToCall = useFlashModel ? this.flashModel : this.proModel;
        const modelLogName = useFlashModel ? this.flashModel.modelName : this.proModel.modelName;
        console.log(chalk.blue(`Querying AI for simple text (using ${modelLogName})...`));

        try {
            // Use the chat-focused method of the model, assuming it handles simple text gen too
            const responseText = await modelToCall.getResponseFromAI(messages);

            console.log(chalk.blue(`Received simple text response (Length: ${responseText.length})`));
            return responseText;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`Error getting simple text from AI model (${modelLogName}):`), errorMessage);
            throw error;
        }
    }

    // --- generateContent (Handles Function Calling) ---
    // Also does NOT automatically prepend the hidden conversation instruction.
    // Callers using function calls are expected to structure the full request.
    async generateContent(
        request: GenerateContentRequest, // Use the SDK's request type
        useFlashModel: boolean = false
    ): Promise<GenerateContentResult> { // Return the SDK's result type
        // ... (Implementation remains the same - no hidden prompt added here) ...
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
                const finishReason = firstCandidate?.finishReason;
                console.log(chalk.yellow(`Received response with no function call or text. Finish Reason: ${finishReason}`));
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
}

// Export the FunctionDeclaration type if needed elsewhere, or define tool within CodeProcessor
export { AIClient, FunctionDeclaration }; // Export FunctionDeclaration for typing the tool