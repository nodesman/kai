// File: src/lib/UserInterface.ts
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises'; // Use fs.promises for async operations
import crypto from 'crypto'; // For checking file changes
import { FileSystem } from './FileSystem';
import { toSnakeCase } from './utils'; // Import the utility function
import { Config } from './Config'; // Import Config
import Conversation, { Message } from './models/Conversation'; // Import Conversation types

// const SUBLIME_TEMP_FILENAME = 'kai_prompt_edit.txt'; // Removed, now dynamic
const HISTORY_SEPARATOR = '--------------------';
const INPUT_MARKER = 'User:\n\n'; // Marker for the user input area

class UserInterface {
    fs: FileSystem;
    config: Config; // Add config

    constructor(config: Config) { // Accept config
        this.fs = new FileSystem();
        this.config = config; // Store config
    }

    // --- NEW METHODS (from previous response - keep as is) ---

    async selectOrCreateConversation(): Promise<{ name: string; isNew: boolean }> {
        await this.fs.ensureDirExists(this.config.chatsDir); // Ensure dir exists
        const existingConversations = await this.fs.listJsonlFiles(this.config.chatsDir);

        const choices = [...existingConversations, new inquirer.Separator(), '<< Create New Conversation >>'];

        const { selected } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selected',
                message: 'Select a conversation or create a new one:',
                choices: choices,
                loop: false, // Prevent looping within this prompt
            },
        ]);

        if (selected === '<< Create New Conversation >>') {
            const { newName } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'newName',
                    message: 'Enter a name for the new conversation:',
                    validate: (input) => (input.trim() ? true : 'Conversation name cannot be empty.'),
                    filter: (input) => input.trim(), // Trim the input
                },
            ]);
            // Check if a conversation with the snake-cased version already exists
            const snakeName = toSnakeCase(newName);
            if (existingConversations.includes(snakeName)) {
                console.warn(`A conversation file for "${snakeName}" already exists. Reusing it.`);
                return { name: snakeName, isNew: false }; // Treat as existing if file name conflicts
            }
            return { name: newName, isNew: true }; // Return original name for display, snake_case happens later
        } else {
            return { name: selected, isNew: false }; // Name is already snake_cased here
        }
    }

    formatHistoryForSublime(messages: Message[]): string {
        let content = INPUT_MARKER; // Start with the input marker

        // Add messages in reverse chronological order
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            // Handle potential missing timestamps gracefully
            const timestampStr = msg.timestamp
                ? new Date(msg.timestamp).toLocaleString()
                : 'Unknown Time';
            const roleLabel = msg.role === 'user' ? 'User' : 'LLM'; // Simpler label

            content += `\n${HISTORY_SEPARATOR}\n`;
            content += `${roleLabel}: [${timestampStr}]\n\n`;
            content += `${msg.content.trim()}\n`; // Trim content before adding
        }
        return content;
    }

    extractNewPrompt(fullContent: string): string | null {
        const inputMarkerIndex = fullContent.indexOf(INPUT_MARKER);
        // The history separator might not exist if it's the very first prompt
        const separatorIndex = fullContent.indexOf(HISTORY_SEPARATOR);

        if (inputMarkerIndex === -1) {
            console.error("Could not find input marker in Sublime file content.");
            return null; // Or throw error
        }

        const startIndex = inputMarkerIndex + INPUT_MARKER.length;
        // If separator exists and is *after* the input marker, use it as end. Otherwise, use end of file.
        const endIndex = (separatorIndex !== -1 && separatorIndex > startIndex)
            ? separatorIndex
            : fullContent.length;

        // Extract and trim the prompt
        const prompt = fullContent.substring(startIndex, endIndex).trim();
        return prompt;
    }

    // Modified getPromptViaSublimeLoop - handles ONE iteration of the edit cycle
    async getPromptViaSublimeLoop(
        conversationName: string, // Expect original or snake_case name
        currentMessages: Message[] // Pass the current state
    ): Promise<{ newPrompt: string | null; conversationFilePath: string; editorFilePath: string }> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`; // Ensure snake_case for file
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        const editorFileName = `${toSnakeCase(conversationName)}_edit.txt`; // Separate file for editing
        const editorFilePath = path.join(this.config.chatsDir, editorFileName); // Store alongside jsonl

        // Prepare content for the editor
        const contentToWrite = this.formatHistoryForSublime(currentMessages);
        const initialHash = crypto.createHash('sha256').update(contentToWrite).digest('hex');

        try {
            await this.fs.writeFile(editorFilePath, contentToWrite); // Write history + input marker
        } catch (writeError) {
            console.error(`Error writing temporary edit file ${editorFilePath}:`, writeError);
            throw writeError; // Propagate error
        }

        console.log(`\nOpening conversation "${conversationName}" in Sublime Text...`);
        console.log(`(Type your prompt, save, and close Sublime to send)`);
        console.log(`(Close without saving OR save without changes to exit conversation)`);

        const sublProcess = spawn('subl', ['-w', editorFilePath], { stdio: 'inherit' });

        const exitCode = await new Promise<number | null>((resolve, reject) => {
            sublProcess.on('close', (code) => resolve(code));
            sublProcess.on('error', (error) => {
                if ((error as any).code === 'ENOENT') {
                    console.error("\n❌ Error: 'subl' command not found. Make sure Sublime Text is installed and 'subl' is in your system's PATH.");
                    reject(new Error("'subl' command not found."));
                } else {
                    console.error("\n❌ Error spawning Sublime Text:", error);
                    reject(error);
                }
            });
        });

        // Handle Sublime exit codes or errors
        if (exitCode === null || exitCode !== 0) {
            console.warn(`\nSublime Text process closed unexpectedly (code: ${exitCode}). Assuming exit.`);
            // No need to delete editor file here, CodeProcessor will handle cleanup
            return { newPrompt: null, conversationFilePath, editorFilePath }; // Indicate exit
        }

        // Read the potentially modified content
        let modifiedContent: string;
        try {
            // Ensure file exists before reading, handle potential race condition or deletion
            await fs.access(editorFilePath);
            modifiedContent = await this.fs.readFile(editorFilePath) || ''; // Read back, default to empty string if somehow null
        } catch (readError) {
            if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(`\nEditor file ${editorFilePath} not found after closing Sublime. Assuming exit.`);
                return { newPrompt: null, conversationFilePath, editorFilePath }; // Indicate exit
            }
            console.error(`\nError reading editor file ${editorFilePath} after closing:`, readError);
            // No cleanup here, let CodeProcessor handle it
            throw readError; // Propagate error
        }

        const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');

        // Compare hashes to see if the user actually typed anything new
        if (initialHash === modifiedHash) {
            console.log("\nNo changes detected in Sublime Text. Exiting conversation.");
            // No cleanup here
            return { newPrompt: null, conversationFilePath, editorFilePath }; // Indicate exit
        }

        // Extract the *new* text entered by the user
        const newPrompt = this.extractNewPrompt(modifiedContent);

        if (newPrompt === null || !newPrompt.trim()) {
            console.log("\nNo new prompt entered. Exiting conversation.");
            // No cleanup here
            return { newPrompt: null, conversationFilePath, editorFilePath }; // Indicate exit
        }

        // Return the new prompt and paths for processing
        console.log("\nPrompt received, processing with AI...");
        return { newPrompt: newPrompt.trim(), conversationFilePath, editorFilePath };
    }

    // --- getUserInteraction - Simplified ---
    // This now ONLY selects the mode and conversation details.
    // The actual prompt input is handled by getPromptViaSublimeLoop within CodeProcessor.
    async getUserInteraction(): Promise<{
        mode: string;
        conversationName: string; // This will be the user-facing or selected name
        isNewConversation: boolean;
    } | null> {
        try {
            const { mode } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Select a mode:',
                    choices: ['Start/Continue Conversation', 'Request Code Changes (TUI - Experimental)'],
                },
            ]);

            if (mode === 'Request Code Changes (TUI - Experimental)') {
                console.log("Code Change mode selected. Starting UI...");
                // Return null or specific object for TUI mode if needed
                // For now, let's assume TUI needs separate handling initiated differently
                // We need conversationName for TUI too, perhaps? For now, focus on chat.
                return { mode, conversationName: "code_changes_tui", isNewConversation: true }; // Placeholder
            } else if (mode === 'Start/Continue Conversation') {
                const conversationDetails = await this.selectOrCreateConversation();
                return {
                    mode,
                    conversationName: conversationDetails.name, // Original or selected name
                    isNewConversation: conversationDetails.isNew,
                };
            } else {
                return null; // Should not happen with the choices given
            }

        } catch (error) {
            // Handle potential errors during prompts (e.g., user force-quitting)
            if ((error as any).isTtyError) {
                console.error("\nPrompt couldn't be rendered in this environment.");
            } else if (error instanceof Error && error.message.includes("'subl' command not found")) {
                // Error already logged in getPromptViaSublimeLoop if called, but catch here too
                console.error("\nFailed to start Sublime Text. Please ensure it's installed and 'subl' is in your PATH.");
            }
            else {
                console.error('\nError during user interaction:', error);
            }
            return null; // Indicate failure or exit
        }
    }

    // --- Removed getPromptFromSublime (replaced by getPromptViaSublimeLoop) ---
}

export { UserInterface };