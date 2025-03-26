// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient } from './AIClient'; // Assuming AIClient is correctly imported
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { Config } from "./Config";
import { UserInterface } from './UserInterface';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { toSnakeCase } from './utils';
import FullScreenUI from "./iterativeDiff/FullScreenUI";
import chalk from 'chalk';

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    ui: UserInterface;
    projectRoot: string;

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        // Pass config to AIClient if needed, ensure it's instantiated correctly
        this.aiClient = new AIClient(config);
        this.ui = new UserInterface(config);
        this.projectRoot = process.cwd();
    }

    countTokens(text: string): number {
        return gpt3Encode(text).length;
    }

    // --- buildContextString - Refined (No major changes needed here) ---
    async buildContextString(): Promise<{ context: string, tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context...'));
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const fileContents = await this.fs.readFileContents(filePaths);

        // Use a slightly more descriptive starting string for clarity when prepended
        let contextString = "Code Base Context:\n"; // Changed header
        let currentTokenCount = this.countTokens(contextString);
        // Keep token limit for context building itself, even if not limiting the *entire* prompt here
        const maxContextTokens = (this.config.gemini.max_prompt_tokens || 8000) * 0.6;
        let includedFiles = 0;
        let excludedFiles = 0;

        const sortedFilePaths = Object.keys(fileContents).sort();

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) {
                excludedFiles++;
                continue;
            }

            content = this.optimizeWhitespace(content);
            if (!content) {
                excludedFiles++;
                continue;
            }

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileBlock);

            contextString += fileBlock;
            currentTokenCount += fileTokens;
            includedFiles++;
        }
        console.log(chalk.blue(`Context built with ${currentTokenCount} tokens from ${includedFiles} files (${excludedFiles} files excluded/skipped).`));
        return { context: contextString, tokenCount: currentTokenCount };
    }

    optimizeWhitespace(code: string): string {
        // Simple optimizations (same as before)
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
                // No initial context message added to history here
            }

            // --- The Conversation Loop ---
            while (true) {
                // 1. Get user prompt via Sublime loop
                const interactionResult = await this.ui.getPromptViaSublimeLoop(
                    conversationName,
                    conversation.getMessages() // Pass current history for display
                );

                editorFilePath = interactionResult.editorFilePath;

                if (interactionResult.newPrompt === null) {
                    break; // User exited
                }

                const userPrompt = interactionResult.newPrompt;

                // 2. Add ONLY the user's prompt to the conversation history
                // The context will be handled by the AIClient just before sending
                conversation.addMessage('user', userPrompt);

                try {
                    // 3. Build the context string NOW, right before the AI call
                    console.log(chalk.blue("Building context for current request..."));
                    const { context: currentContextString } = await this.buildContextString();
                    // We still build it fresh each time to reflect potential file changes.

                    // 4. Call AIClient, passing the conversation AND the context string separately
                    // AIClient will be responsible for combining history + context + prompt for the API
                    await this.aiClient.getResponseFromAI(
                        conversation,
                        conversationFilePath,
                        currentContextString // Pass the context here
                    );
                    // AI response is added to 'conversation' inside getResponseFromAI (as before)

                } catch (aiError) {
                    console.error(chalk.red("Error during AI interaction:"), aiError);
                    // Add a temporary error message for display in Sublime
                    conversation.addMessage('system', `[Error occurred during AI request: ${(aiError as Error).message}. Please check logs. You can try again or exit.]`);
                    // Important: This system message is for UI feedback and likely won't be persisted unless AIClient logs it separately on error.
                    // If the AI call failed, the user's prompt *is* still in the history.
                }
            } // --- End while loop ---

            console.log(`\nExiting conversation "${conversationName}".`);

        } catch (error) {
            console.error(chalk.red(`\nAn unexpected error occurred in conversation "${conversationName}":`), error);
            if (conversationFilePath) {
                try {
                    // Log the processor-level error if possible
                    await this.aiClient.logConversation(conversationFilePath, {
                        type: 'error',
                        error: `CodeProcessor loop error: ${(error as Error).message}`
                    });
                } catch (logErr) {
                    console.error(chalk.red("Additionally failed to log CodeProcessor error:"), logErr);
                }
            }
        } finally {
            // --- Cleanup (same as before) ---
            if (editorFilePath) {
                try {
                    await this.fs.access(editorFilePath);
                    await this.fs.deleteFile(editorFilePath);
                    console.log(`Cleaned up editor file: ${editorFilePath}`);
                } catch (cleanupError) {
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