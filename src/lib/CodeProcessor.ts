// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient } from './AIClient';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { Config } from "./Config";
import { UserInterface } from './UserInterface'; // Import UserInterface
import Conversation, { Message, JsonlLogEntry } from './models/Conversation'; // Import Conversation types
import { toSnakeCase } from './utils';
import FullScreenUI from "./iterativeDiff/FullScreenUI"; // Import utility
import chalk from 'chalk'; // Import chalk for better logging

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    ui: UserInterface; // Add UI instance
    projectRoot: string;
    // Cache for context string to avoid rebuilding unnecessarily if files haven't changed
    // For simplicity, we'll rebuild each time for now, but caching is an optimization path.
    // private contextCache: string | null = null;
    // private contextCacheTimestamp: number = 0;

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);
        this.ui = new UserInterface(config); // Instantiate UI here
        this.projectRoot = process.cwd(); // Keep this if needed for context building later
    }

    countTokens(text: string): number {
        // Consider caching token counts per file content if performance becomes an issue
        return gpt3Encode(text).length;
    }

    // --- buildContextString - Refined ---
    async buildContextString(): Promise<{ context: string, tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context...'));
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const fileContents = await this.fs.readFileContents(filePaths);

        let contextString = "Project Context:\n";
        let currentTokenCount = this.countTokens(contextString);
        // Use a slightly larger portion, maybe 60-70%? Adjust as needed.
        const maxContextTokens = (this.config.gemini.max_prompt_tokens || 8000) * 0.6;
        let includedFiles = 0;
        let excludedFiles = 0;

        const sortedFilePaths = Object.keys(fileContents).sort();

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) {
                excludedFiles++;
                continue; // Skip empty files
            }

            content = this.optimizeWhitespace(content);
            if (!content) {
                excludedFiles++;
                continue; // Skip files empty after optimization
            }

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileBlock);

            if (currentTokenCount + fileTokens > maxContextTokens) {
                console.warn(chalk.yellow(`Context truncated. Reached token limit (${maxContextTokens}) near file: ${relativePath}`));
                excludedFiles += (sortedFilePaths.length - includedFiles); // Count remaining as excluded
                break; // Stop adding files
            }

            contextString += fileBlock;
            currentTokenCount += fileTokens;
            includedFiles++;
        }
        console.log(chalk.blue(`Context built with ${currentTokenCount} tokens from ${includedFiles} files (${excludedFiles} files excluded/truncated).`));
        return { context: contextString, tokenCount: currentTokenCount };
    }

    optimizeWhitespace(code: string): string {
        // Simple optimizations
        code = code.replace(/[ \t]+$/gm, ''); // Remove trailing whitespace
        code = code.replace(/\r\n/g, '\n');   // Normalize line endings
        code = code.replace(/\n{3,}/g, '\n\n'); // Collapse multiple blank lines
        code = code.trim();                   // Trim leading/trailing whitespace
        return code;
    }
    // --- End context building ---

    // --- Conversation Loop Manager - Modified ---
    async startConversation(conversationName: string, isNew: boolean): Promise<void> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        let editorFilePath: string | null = null;

        let conversation: Conversation;

        try {
            // Load or create conversation
            if (!isNew) {
                console.log(`Loading conversation: ${conversationName}...`);
                const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
                conversation = Conversation.fromJsonlData(logData);
                console.log(`Loaded ${conversation.getMessages().length} messages.`);
            } else {
                console.log(`Starting new conversation: ${conversationName}`);
                conversation = new Conversation();
                // --- Add Initial Context on New Conversation ---
                // Build context once when starting a new conversation.
                // The user's first actual prompt will be asked *after* this.
                const { context: initialContext } = await this.buildContextString();
                if (initialContext.length > "Project Context:\n".length) { // Check if context isn't empty
                    // Add as a system message? Or just prepend to the *first* user prompt later?
                    // Let's add it as a system message for clarity in history, though it won't be shown in Sublime.
                    // Note: Gemini API might treat 'system' differently or ignore it.
                    // A safer approach might be to prepend it to the *first* user message.
                    // Let's stick to prepending for now. We'll do it before the first user prompt *inside* the loop.
                    console.log(chalk.green("Initial context prepared."));
                }
                // --- End Initial Context ---
            }

            let isFirstUserPromptOfSession = isNew; // Track if it's the first prompt *we ask for* in this run

            // --- The Conversation Loop ---
            while (true) {
                // Get user prompt via Sublime loop
                const interactionResult = await this.ui.getPromptViaSublimeLoop(
                    conversationName,
                    conversation.getMessages()
                );

                editorFilePath = interactionResult.editorFilePath;

                if (interactionResult.newPrompt === null) {
                    break; // User exited
                }

                const userPrompt = interactionResult.newPrompt;

                // --- Prepend Context ---
                console.log(chalk.blue("Checking context and token limits..."));
                let fullPromptContent = userPrompt;
                let contextString = '';
                let contextTokens = 0;

                // Calculate history tokens (excluding system messages if any)
                const historyTokens = conversation.getMessages()
                    .filter(m => m.role === 'user' || m.role === 'assistant') // Only count user/assistant turns for history limit
                    .reduce((sum, m) => sum + this.countTokens(m.content), 0);

                const promptTokens = this.countTokens(userPrompt);
                const maxAllowedTotal = this.config.gemini.max_prompt_tokens || 8000;
                // Leave a buffer for the AI's response and overhead
                const buffer = 1000; // Adjust buffer as needed
                const availableForContext = maxAllowedTotal - historyTokens - promptTokens - buffer;

                console.log(`Tokens - History: ${historyTokens}, Prompt: ${promptTokens}, Available for Context: ${availableForContext}`);

                if (availableForContext > 100) { // Only add context if there's a reasonable amount of space
                    const contextResult = await this.buildContextString(); // Rebuild context each time (could be cached)
                    contextString = contextResult.context;
                    contextTokens = contextResult.tokenCount;

                    if (contextTokens <= availableForContext) {
                        fullPromptContent = `${contextString}\n\n---\nUser Question:\n${userPrompt}`;
                        console.log(chalk.green(`Prepending project context (${contextTokens} tokens) to prompt.`));
                    } else {
                        console.warn(chalk.yellow(`Built context (${contextTokens} tokens) exceeds available space (${availableForContext}). Sending prompt without full context.`));
                        // Optionally, try sending a truncated context? For now, just send the prompt.
                        fullPromptContent = `User Question:\n${userPrompt}`; // Add marker for clarity even without context
                    }
                } else {
                    console.warn(chalk.yellow(`Not enough space for context (Available: ${availableForContext}). Sending prompt without context.`));
                    fullPromptContent = `User Question:\n${userPrompt}`; // Add marker for clarity
                }
                isFirstUserPromptOfSession = false; // No longer the first prompt after the first iteration
                // --- End Prepend Context ---

                // Add the potentially context-prepended user message
                conversation.addMessage('user', fullPromptContent);

                try {
                    // Get response (AIClient logs request/response)
                    await this.aiClient.getResponseFromAI(conversation, conversationFilePath);
                    // AI response is added to 'conversation' inside getResponseFromAI

                } catch (aiError) {
                    console.error(chalk.red("Error during AI interaction:"), aiError);
                    // Log error and add a system message for Sublime display
                    conversation.addMessage('system', `[Error occurred during AI request: ${(aiError as Error).message}. Please check logs. You can try again or exit.]`);
                    // This system message is temporary for display and not saved unless explicitly logged by AIClient
                }
            } // --- End while loop ---

            console.log(`\nExiting conversation "${conversationName}".`);

        } catch (error) {
            console.error(chalk.red(`\nAn unexpected error occurred in conversation "${conversationName}":`), error);
            if (conversationFilePath) {
                try {
                    await this.aiClient.logConversation(conversationFilePath, {
                        type: 'error',
                        error: `CodeProcessor loop error: ${(error as Error).message}`
                    });
                } catch (logErr) {
                    console.error(chalk.red("Additionally failed to log CodeProcessor error:"), logErr);
                }
            }
        } finally {
            // --- Cleanup ---
            if (editorFilePath) {
                try {
                    // Check if file exists before deleting (might already be gone if error occurred early)
                    await this.fs.access(editorFilePath);
                    await this.fs.deleteFile(editorFilePath);
                    console.log(`Cleaned up editor file: ${editorFilePath}`);
                } catch (cleanupError) {
                    // Ignore ENOENT (File not found), log other errors
                    if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                        console.warn(chalk.yellow(`\nWarning: Failed to clean up editor file ${editorFilePath}:`), cleanupError);
                    }
                }
            }
        }
    }

    // --- Method for TUI Mode (placeholder - unchanged) ---
    async startCodeChangeTUI(): Promise<void> {
        console.log("Initializing Code Change TUI...");
        const fullScreenUI = new FullScreenUI();
        fullScreenUI.show();
        return new Promise(() => {}); // Keep alive indefinitely for TUI
    }

}

export { CodeProcessor };