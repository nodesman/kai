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

// Define the expected return type for getUserInteraction
interface UserInteractionResult {
    mode: string;
    conversationName: string;
    isNewConversation: boolean;
    selectedModel: string; // Add the selected model here
}


class UserInterface {
    fs: FileSystem;
    config: Config; // Add config

    constructor(config: Config) { // Accept config
        this.fs = new FileSystem();
        this.config = config; // Store config
    }

    // --- selectOrCreateConversation (Keep as is) ---
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

    // --- formatHistoryForSublime (Keep as is) ---
    formatHistoryForSublime(messages: Message[]): string {
        let historyBlock = '';
        // Add messages in reverse chronological order, below the separator
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const timestampStr = msg.timestamp
                ? new Date(msg.timestamp).toLocaleString()
                : 'Unknown Time';
            const roleLabel = msg.role === 'user' ? 'User' : 'LLM';

            // Separator will be added *once* before the whole block if history exists
            historyBlock += `${roleLabel}: [${timestampStr}]\n\n`; // Simplified slightly
            historyBlock += `${msg.content.trim()}\n\n`; // Add extra newline for spacing between messages
        }

        if (historyBlock) {
            // Add the separator ONCE, above the entire history block
            // Ensure a blank line exists above the separator for typing.
            return '\n\n' + HISTORY_SEPARATOR + '\n\n' + historyBlock.trimEnd(); // Add blank lines above separator, trim trailing space from history
        } else {
            // No history, just return empty string.
            return ''; // User starts with a blank slate.
        }
    }

    // --- extractNewPrompt (Keep as is) ---
    extractNewPrompt(fullContent: string): string | null {
        const separatorIndex = fullContent.indexOf(HISTORY_SEPARATOR);
        let promptRaw: string;

        if (separatorIndex !== -1) {
            // Separator found, take everything before it
            promptRaw = fullContent.substring(0, separatorIndex);
        } else {
            // No separator found, take the whole content
            promptRaw = fullContent;
        }

        const promptTrimmed = promptRaw.trim();

        // Return the trimmed prompt if it's not empty, otherwise null
        return promptTrimmed ? promptTrimmed : null;
    }

    // --- getPromptViaSublimeLoop (Keep as is) ---
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
        console.log(`(Type your prompt above the '${HISTORY_SEPARATOR}', save, and close Sublime to send)`);
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
            return { newPrompt: null, conversationFilePath, editorFilePath }; // Indicate exit
        }

        // Read the potentially modified content
        let modifiedContent: string;
        try {
            await fs.access(editorFilePath);
            modifiedContent = await this.fs.readFile(editorFilePath) || '';
        } catch (readError) {
            if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(`\nEditor file ${editorFilePath} not found after closing Sublime. Assuming exit.`);
                return { newPrompt: null, conversationFilePath, editorFilePath };
            }
            console.error(`\nError reading editor file ${editorFilePath} after closing:`, readError);
            throw readError;
        }

        const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');

        if (initialHash === modifiedHash) {
            console.log("\nNo changes detected in Sublime Text. Exiting conversation.");
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        const newPrompt = this.extractNewPrompt(modifiedContent);

        if (newPrompt === null || !newPrompt.trim()) {
            console.log("\nNo new prompt entered. Exiting conversation.");
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        console.log("\nPrompt received, processing with AI...");
        return { newPrompt: newPrompt.trim(), conversationFilePath, editorFilePath };
    }


    // --- MODIFIED getUserInteraction ---
    // Added model selection prompt and updated return type.
    async getUserInteraction(): Promise<UserInteractionResult | null> { // Use defined interface
        try {
            const { mode } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Select a mode:',
                    choices: ['Start/Continue Conversation', 'Request Code Changes (TUI - Experimental)'],
                },
            ]);

            // --- Model Selection Prompt ---
            const { modelChoice } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'modelChoice',
                    message: 'Select the AI model to use:',
                    choices: [
                        { name: `Gemini 2.5 Pro (Slower, Powerful)`, value: 'gemini-2.5-pro-exp-03-25' }, // Use actual model name strings
                        { name: `Gemini 2.0 Flash (Faster, Lighter)`, value: 'gemini-2.0-flash' },
                        // Optionally allow keeping the configured default without explicitly choosing
                        // { name: `Use Config Default (${this.config.gemini.model_name})`, value: this.config.gemini.model_name }
                    ],
                    // Default to the value currently in config for pre-selection
                    default: this.config.gemini.model_name,
                },
            ]);
            const selectedModel = modelChoice;
            // --- End Model Selection ---


            if (mode === 'Request Code Changes (TUI - Experimental)') {
                console.log("Code Change mode selected. Starting UI...");
                // TUI mode also gets the selected model
                return {
                    mode,
                    conversationName: "code_changes_tui", // Placeholder, might need refinement
                    isNewConversation: true,
                    selectedModel: selectedModel, // Pass selected model
                };
            } else if (mode === 'Start/Continue Conversation') {
                const conversationDetails = await this.selectOrCreateConversation();
                return {
                    mode,
                    conversationName: conversationDetails.name, // Original or selected name
                    isNewConversation: conversationDetails.isNew,
                    selectedModel: selectedModel, // Pass selected model
                };
            } else {
                return null; // Should not happen
            }

        } catch (error) {
            if ((error as any).isTtyError) {
                console.error("\nPrompt couldn't be rendered in this environment.");
            } else if (error instanceof Error && error.message.includes("'subl' command not found")) {
                console.error("\nFailed to start Sublime Text. Please ensure it's installed and 'subl' is in your PATH.");
            }
            else {
                console.error('\nError during user interaction:', error);
            }
            return null; // Indicate failure or exit
        }
    }
}

export { UserInterface };