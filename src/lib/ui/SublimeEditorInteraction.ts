// src/lib/ui/SublimeEditorInteraction.ts
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import chalk from 'chalk';
import { FileSystem } from '../FileSystem';
import { Config } from '../Config';
import { Message } from '../models/Conversation';
import { toSnakeCase } from '../utils'; // Import from shared utils

const HISTORY_SEPARATOR = '--- TYPE YOUR PROMPT ABOVE THIS LINE ---';

// Result type for the editor interaction
export interface EditorInteractionResult {
    newPrompt: string | null;
    // No need to return file paths if managed internally
}

export class SublimeEditorInteraction {
    private fs: FileSystem;
    private config: Config;

    constructor(fileSystem: FileSystem, config: Config) {
        this.fs = fileSystem;
        this.config = config;
    }

    /**
     * Opens Sublime Text with conversation history, waits for user input,
     * and returns the new prompt.
     * @param conversationName - The name of the conversation (used for editor file naming).
     * @param currentMessages - The current list of messages in the conversation.
     * @returns The extracted new prompt, or null if user exited/provided no input.
     */
    async getPrompt(
        conversationName: string,
        currentMessages: Message[]
    ): Promise<EditorInteractionResult> {
        // Generate editor file path within this method
        const editorFileName = `${toSnakeCase(conversationName)}_edit.txt`;
        const editorFilePath = path.join(this.config.chatsDir, editorFileName);

        const contentToWrite = this.formatHistoryForSublime(currentMessages || []);
        const initialHash = crypto.createHash('sha256').update(contentToWrite).digest('hex');

        let cleanupEditorFile = false; // Flag to control cleanup

        try {
            // Ensure the chats directory exists before writing
            await this.fs.ensureDirExists(this.config.chatsDir);
            await this.fs.writeFile(editorFilePath, contentToWrite);
            cleanupEditorFile = true; // Mark for cleanup after successful write

            console.log(chalk.blue(`\nOpening conversation "${conversationName}" in Sublime Text...`));
            console.log(chalk.dim(`(File: ${editorFilePath})`));
            console.log(chalk.dim(`(Type your prompt above the '${HISTORY_SEPARATOR}', save, and close Sublime to send)`));
            console.log(chalk.dim(`(Close without saving OR save without changes to exit conversation)`));

            const sublProcess = spawn('subl', ['-w', editorFilePath], { stdio: 'inherit' });

            const exitCode = await new Promise<number | null>((resolve, reject) => {
                sublProcess.on('close', (code) => resolve(code));
                sublProcess.on('error', (error) => {
                    if ((error as any).code === 'ENOENT') {
                        console.error(chalk.red("\n❌ Error: 'subl' command not found."));
                        console.error(chalk.red("   Make sure Sublime Text is installed and the 'subl' command-line tool"));
                        console.error(chalk.red("   is available in your system's PATH."));
                        console.error(chalk.yellow("   See: https://www.sublimetext.com/docs/command_line.html"));
                        reject(new Error("'subl' command not found.'"));
                    } else {
                        console.error(chalk.red("\n❌ Error spawning Sublime Text:"), error);
                        reject(error);
                    }
                });
            });

            // Handle non-zero exit codes or null explicitly
            if (exitCode !== 0) {
                console.warn(chalk.yellow(`\nSublime Text process closed unexpectedly (exit code: ${exitCode ?? 'unknown'}). Assuming exit.`));
                return { newPrompt: null }; // Treat unexpected close as exit
            }

            // Read the potentially modified content
            let modifiedContent: string;
            try {
                // Use fs.promises.access to check existence explicitly before reading
                await fs.access(editorFilePath);
                modifiedContent = await this.fs.readFile(editorFilePath) || '';
            } catch (readError) {
                if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
                    // This case might happen if the user manually deleted the file before closing subl
                    console.warn(chalk.yellow(`\nEditor file ${editorFilePath} not found after closing Sublime. Assuming exit.`));
                    cleanupEditorFile = false; // Don't try to delete if it wasn't found
                    return { newPrompt: null };
                }
                // Log and re-throw other unexpected read errors
                console.error(chalk.red(`\nError reading editor file ${editorFilePath} after closing:`), readError);
                throw readError;
            }

            const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');

            if (initialHash === modifiedHash) {
                console.log(chalk.blue("\nNo changes detected in Sublime Text. Exiting conversation."));
                return { newPrompt: null };
            }

            const newPrompt = this.extractNewPrompt(modifiedContent);

            if (newPrompt === null) {
                console.log(chalk.blue("\nNo new prompt entered (file saved but prompt area empty). Exiting conversation."));
                return { newPrompt: null };
            }

            console.log(chalk.green("\nPrompt received, processing..."));
            return { newPrompt: newPrompt };

        } catch (error) {
            // Log errors related to file writing or subl spawning
            console.error(chalk.red(`Error during Sublime editor interaction setup for ${conversationName}:`), error);
            // Ensure we don't leave the flag set if the initial write failed or subl error occurred
            if (!(error instanceof Error && error.message.includes("'subl' command not found"))) {
                 cleanupEditorFile = false; // Don't attempt cleanup if write failed or subl error isn't the specific 'not found' one
            }
            // Propagate the error or signal an exit based on desired handling
            // Returning null signals an exit from the conversation loop in CodeProcessor/main loop
            return { newPrompt: null };
        } finally {
            // Cleanup the editor file if it was successfully created and should be cleaned up
            if (cleanupEditorFile) {
                await this.cleanupEditorFile(editorFilePath);
            }
        }
    }

    /**
     * Formats conversation messages for display in the editor file.
     * Puts the prompt area at the top, followed by the separator and history.
     * @param messages - The array of messages.
     * @returns A formatted string including history and the separator.
     */
    private formatHistoryForSublime(messages: Message[]): string {
        let historyBlock = '';
        // Build history string (newest first, below the separator)
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const timestampStr = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'Unknown Time';
            const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'LLM' : 'System'; // Handle system role

            historyBlock += `---------- ${roleLabel}: [${timestampStr}] ----------\n`;
            historyBlock += `${msg.content.trim()}\n\n`; // Add extra newline for separation
        }

        // Construct final content: Empty space for prompt, separator, then history
        let finalContent = '\n\n' + // Add some space at the top for the user prompt
                           HISTORY_SEPARATOR + '\n\n';

        if (historyBlock) {
             finalContent += '--- (Below is the history. Newest messages are first) ---\n\n' + historyBlock.trimEnd();
        } else {
            finalContent += '--- (No conversation history yet) ---\n';
        }

        return finalContent;
    }

    /**
     * Extracts the new prompt text from the editor file content.
     * The prompt is expected to be above the HISTORY_SEPARATOR.
     * @param fullContent - The full content read from the editor file.
     * @returns The trimmed prompt text, or null if empty or separator not found correctly.
     */
    private extractNewPrompt(fullContent: string): string | null {
        const separatorIndex = fullContent.indexOf(HISTORY_SEPARATOR);
        let promptRaw: string;

        if (separatorIndex !== -1) {
            // Extract text *before* the separator
            promptRaw = fullContent.substring(0, separatorIndex);
        } else {
            // If separator is somehow missing (e.g., user deleted it), treat the whole file as the prompt
            // This is less ideal but prevents losing input entirely.
            console.warn(chalk.yellow("Warning: History separator not found in editor file. Treating entire content as prompt."));
            promptRaw = fullContent;
        }

        const promptTrimmed = promptRaw.trim();

        // Return the trimmed prompt, or null if it's empty after trimming
        return promptTrimmed ? promptTrimmed : null;
    }

    /**
     * Deletes the temporary editor file.
     * @param editorFilePath - The absolute path to the editor file.
     */
    private async cleanupEditorFile(editorFilePath: string): Promise<void> {
        if (!editorFilePath) return; // Guard against null/undefined path

        try {
            // Check if the file exists before attempting deletion
            await fs.access(editorFilePath);
            await this.fs.deleteFile(editorFilePath);
            console.log(chalk.dim(`Cleaned up editor file: ${editorFilePath}`));
        } catch (cleanupError) {
            // Only log errors that aren't "file not found" (ENOENT)
            // If it's already gone, that's fine.
            if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(chalk.yellow(`\nWarning: Failed to clean up editor file ${editorFilePath}:`), cleanupError);
            } else {
                console.log(chalk.dim(`Editor file already gone or never created: ${editorFilePath}`));
            }
        }
    }

    // Note: toSnakeCase is now imported from src/lib/utils.ts
}