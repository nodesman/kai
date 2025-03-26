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
import chalk from 'chalk'; // Import chalk for logging

// --- Define the missing constant ---
const HISTORY_SEPARATOR = '--- TYPE YOUR PROMPT ABOVE THIS LINE ---';
// --- End constant definition ---

// Define the expected return type for getUserInteraction
interface UserInteractionResult {
    mode: string;
    conversationName: string | null; // Can be null for modes not needing a specific conversation yet (like TUI)
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

    // --- selectOrCreateConversation (Unchanged from previous version) ---
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

    // --- formatHistoryForSublime (Now uses the defined constant) ---
    formatHistoryForSublime(messages: Message[]): string {
        let historyBlock = '';
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const timestampStr = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'Unknown Time';
            const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'LLM' : 'System'; // Handle system role

            historyBlock += `${roleLabel}: [${timestampStr}]\n\n`;
            historyBlock += `${msg.content.trim()}\n\n`;
        }

        if (historyBlock) {
            // Add the separator ONCE, above the entire history block
            return '\n\n' + HISTORY_SEPARATOR + '\n\n' + historyBlock.trimEnd();
        } else {
            // If there's no history, just provide the separator to guide the user
            return HISTORY_SEPARATOR + '\n\n'; // Ensure separator is still present
        }
    }

    // --- extractNewPrompt (Now uses the defined constant) ---
    extractNewPrompt(fullContent: string): string | null {
        const separatorIndex = fullContent.indexOf(HISTORY_SEPARATOR);
        let promptRaw: string;

        if (separatorIndex !== -1) {
            promptRaw = fullContent.substring(0, separatorIndex);
        } else {
            // If separator is somehow missing, assume the whole file is the prompt
            console.warn(chalk.yellow("Warning: History separator not found in editor file. Treating entire content as prompt."));
            promptRaw = fullContent;
        }

        const promptTrimmed = promptRaw.trim();
        return promptTrimmed ? promptTrimmed : null;
    }

    // --- getPromptViaSublimeLoop (Now uses the defined constant) ---
    async getPromptViaSublimeLoop(
        conversationName: string,
        currentMessages: Message[]
    ): Promise<{ newPrompt: string | null; conversationFilePath: string; editorFilePath: string }> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        const editorFileName = `${toSnakeCase(conversationName)}_edit.txt`;
        const editorFilePath = path.join(this.config.chatsDir, editorFileName);

        // Pass empty array if no messages to ensure separator is added by formatHistoryForSublime
        const contentToWrite = this.formatHistoryForSublime(currentMessages || []);
        const initialHash = crypto.createHash('sha256').update(contentToWrite).digest('hex');

        try {
            await this.fs.writeFile(editorFilePath, contentToWrite);
        } catch (writeError) {
            console.error(`Error writing temporary edit file ${editorFilePath}:`, writeError);
            throw writeError;
        }

        console.log(`\nOpening conversation "${conversationName}" in Sublime Text...`);
        console.log(`(Type your prompt above the '${HISTORY_SEPARATOR}', save, and close Sublime to send)`);
        console.log(`(Close without saving OR save without changes to exit conversation)`);

        const sublProcess = spawn('subl', ['-w', editorFilePath], { stdio: 'inherit' });

        const exitCode = await new Promise<number | null>((resolve, reject) => {
            sublProcess.on('close', (code) => resolve(code));
            sublProcess.on('error', (error) => {
                if ((error as any).code === 'ENOENT') {
                    console.error(chalk.red("\n❌ Error: 'subl' command not found. Make sure Sublime Text is installed and 'subl' is in your system's PATH."));
                    reject(new Error("'subl' command not found."));
                } else {
                    console.error(chalk.red("\n❌ Error spawning Sublime Text:"), error);
                    reject(error);
                }
            });
        });

        // Check exit code before proceeding
        if (exitCode !== 0) { // Check specifically for non-zero exit code
            console.warn(chalk.yellow(`\nSublime Text process closed with non-zero code: ${exitCode}. Assuming exit.`));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        let modifiedContent: string;
        try {
            // Ensure file exists before reading
            await fs.access(editorFilePath);
            modifiedContent = await this.fs.readFile(editorFilePath) || '';
        } catch (readError) {
            if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(chalk.yellow(`\nEditor file ${editorFilePath} not found after closing Sublime. Assuming exit.`));
                return { newPrompt: null, conversationFilePath, editorFilePath };
            }
            console.error(chalk.red(`\nError reading editor file ${editorFilePath} after closing:`), readError);
            throw readError; // Rethrow unexpected errors
        }

        const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');

        if (initialHash === modifiedHash) {
            console.log(chalk.blue("\nNo changes detected in Sublime Text. Exiting conversation."));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        const newPrompt = this.extractNewPrompt(modifiedContent);

        if (newPrompt === null) { // Check for null (meaning empty prompt area)
            console.log(chalk.blue("\nNo new prompt entered. Exiting conversation."));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        console.log(chalk.green("\nPrompt received, processing with AI..."));
        return { newPrompt: newPrompt, conversationFilePath, editorFilePath }; // Return trimmed prompt
    }

    // --- getUserInteraction (Unchanged from previous version) ---
    async getUserInteraction(): Promise<UserInteractionResult | null> {
        try {
            const { mode } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Select a mode:',
                    choices: [
                        'Start/Continue Conversation',
                        'Consolidate Changes...',
                        'Request Code Changes (TUI - Experimental)',
                    ],
                },
            ]);

            const { modelChoice } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'modelChoice',
                    message: 'Select the AI model to use for this operation:',
                    choices: [
                        { name: `Gemini 2.5 Pro (Slower, Powerful)`, value: 'gemini-2.5-pro-exp-03-25' },
                        { name: `Gemini 2.0 Flash (Faster, Lighter)`, value: 'gemini-2.0-flash' },
                    ],
                    default: this.config.gemini.model_name,
                },
            ]);
            const selectedModel = modelChoice;

            let conversationDetails: { name: string; isNew: boolean } | null = null;
            let conversationName: string | null = null;
            let isNewConversation = false;

            if (mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...') {
                conversationDetails = await this.selectOrCreateConversation();
                if (mode === 'Consolidate Changes...' && conversationDetails.isNew) {
                    console.error(chalk.red("Error: Cannot consolidate changes for a newly created (empty) conversation."));
                    return null;
                }
                conversationName = conversationDetails.name;
                isNewConversation = conversationDetails.isNew;
            }

            if (mode === 'Start/Continue Conversation') {
                return { mode, conversationName: conversationName, isNewConversation: isNewConversation, selectedModel: selectedModel };
            } else if (mode === 'Consolidate Changes...') {
                return { mode, conversationName: conversationName, isNewConversation: false, selectedModel: selectedModel };
            } else if (mode === 'Request Code Changes (TUI - Experimental)') {
                return { mode, conversationName: "code_changes_tui", isNewConversation: true, selectedModel: selectedModel };
            } else {
                console.warn(chalk.yellow(`Unhandled mode selection: ${mode}`));
                return null;
            }

        } catch (error) {
            if ((error as any).isTtyError) {
                console.error(chalk.red("\nPrompt couldn't be rendered in this environment."));
            } else {
                console.error(chalk.red('\nError during user interaction:'), error);
            }
            return null;
        }
    }
}

export { UserInterface, UserInteractionResult };