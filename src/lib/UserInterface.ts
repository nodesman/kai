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

const HISTORY_SEPARATOR = '--- TYPE YOUR PROMPT ABOVE THIS LINE ---';

// Define the expected return type for getUserInteraction
// --- MODIFICATION: Update return type for Delete mode ---
interface UserInteractionResultBase {
    mode: 'Start/Continue Conversation' | 'Consolidate Changes...';
    conversationName: string | null; // Used for conversation ops
    isNewConversation: boolean; // Relevant only for Start/Continue
    selectedModel: string;
}

interface DeleteInteractionResult {
    mode: 'Delete Conversation...';
    conversationNamesToDelete: string[]; // Array of names to delete
    // conversationName, isNewConversation, selectedModel are not relevant here
}

type UserInteractionResult = UserInteractionResultBase | DeleteInteractionResult;
// --- END MODIFICATION ---

class UserInterface {
    fs: FileSystem;
    config: Config; // Add config

    constructor(config: Config) { // Accept config
        this.fs = new FileSystem();
        this.config = config; // Store config
    }

    // --- selectOrCreateConversation (Unchanged) ---
    async selectOrCreateConversation(): Promise<{ name: string; isNew: boolean }> {
        await this.fs.ensureDirExists(this.config.chatsDir); // Ensure dir exists
        const existingConversations = await this.fs.listJsonlFiles(this.config.chatsDir);

        const choices = [
            '<< Create New Conversation >>',
            new inquirer.Separator(),
            ...existingConversations
        ];

        const { selected } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selected',
                message: 'Select a conversation or create a new one:',
                choices: choices,
                loop: false,
                pageSize: 15
            },
        ]);

        if (selected === '<< Create New Conversation >>') {
            const { newName } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'newName',
                    message: 'Enter a name for the new conversation:',
                    validate: (input) => (input.trim() ? true : 'Conversation name cannot be empty.'),
                    filter: (input) => input.trim(),
                },
            ]);
            const snakeName = toSnakeCase(newName);
            if (existingConversations.includes(snakeName)) {
                console.warn(chalk.yellow(`Warning: A conversation file for "${snakeName}" already exists. Reusing it.`));
                return { name: snakeName, isNew: false };
            }
            return { name: newName, isNew: true };
        } else {
            return { name: selected, isNew: false };
        }
    }

    // --- REMOVED selectConversationToDelete method ---
    // This is replaced by the multi-select logic directly in getUserInteraction

    // --- formatHistoryForSublime (Unchanged) ---
    formatHistoryForSublime(messages: Message[]): string {
        let historyBlock = '';
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const timestampStr = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'Unknown Time';
            const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'LLM' : 'System';

            historyBlock += `${roleLabel}: [${timestampStr}]\n\n`;
            historyBlock += `${msg.content.trim()}\n\n`;
        }

        if (historyBlock) {
            return '\n\n' + HISTORY_SEPARATOR + '\n\n' + historyBlock.trimEnd();
        } else {
            return HISTORY_SEPARATOR + '\n\n';
        }
    }

    // --- extractNewPrompt (Unchanged) ---
    extractNewPrompt(fullContent: string): string | null {
        const separatorIndex = fullContent.indexOf(HISTORY_SEPARATOR);
        let promptRaw: string;

        if (separatorIndex !== -1) {
            promptRaw = fullContent.substring(0, separatorIndex);
        } else {
            console.warn(chalk.yellow("Warning: History separator not found in editor file. Treating entire content as prompt."));
            promptRaw = fullContent;
        }

        const promptTrimmed = promptRaw.trim();
        return promptTrimmed ? promptTrimmed : null;
    }

    // --- getPromptViaSublimeLoop (Unchanged) ---
    async getPromptViaSublimeLoop(
        conversationName: string,
        currentMessages: Message[],
        editorFilePath: string
    ): Promise<{ newPrompt: string | null; conversationFilePath: string; editorFilePath: string }> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);

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
                    reject(new Error("'subl' command not found.'"));
                } else {
                    console.error(chalk.red("\n❌ Error spawning Sublime Text:"), error);
                    reject(error);
                }
            });
        });

        if (exitCode !== 0) {
            console.warn(chalk.yellow(`\nSublime Text process closed with non-zero code: ${exitCode}. Assuming exit.`));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        let modifiedContent: string;
        try {
            await fs.access(editorFilePath);
            modifiedContent = await this.fs.readFile(editorFilePath) || '';
        } catch (readError) {
            if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(chalk.yellow(`\nEditor file ${editorFilePath} not found after closing Sublime. Assuming exit.`));
                return { newPrompt: null, conversationFilePath, editorFilePath };
            }
            console.error(chalk.red(`\nError reading editor file ${editorFilePath} after closing:`), readError);
            throw readError;
        }

        const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');

        if (initialHash === modifiedHash) {
            console.log(chalk.blue("\nNo changes detected in Sublime Text. Exiting conversation."));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        const newPrompt = this.extractNewPrompt(modifiedContent);

        if (newPrompt === null) {
            console.log(chalk.blue("\nNo new prompt entered. Exiting conversation."));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        console.log(chalk.green("\nPrompt received, processing with AI..."));
        return { newPrompt: newPrompt, conversationFilePath, editorFilePath };
    }

    // --- getUserInteraction (MODIFIED FOR MULTI-DELETE) ---
    async getUserInteraction(): Promise<UserInteractionResult | null> {
        try {
            const { mode } = await inquirer.prompt<{ mode: UserInteractionResult['mode'] }>([
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Select a mode:',
                    choices: [
                        'Start/Continue Conversation',
                        'Consolidate Changes...',
                        'Delete Conversation...', // Stays the same here
                    ],
                },
            ]);

            // --- Handle Delete Conversation Mode ---
            if (mode === 'Delete Conversation...') {
                await this.fs.ensureDirExists(this.config.chatsDir);
                const existingConversations = await this.fs.listJsonlFiles(this.config.chatsDir);

                if (existingConversations.length === 0) {
                    console.log(chalk.yellow("No conversations found to delete."));
                    return null;
                }

                const { conversationsToDelete } = await inquirer.prompt<{ conversationsToDelete: string[] }>([
                    {
                        type: 'checkbox', // Use checkbox for multi-select
                        name: 'conversationsToDelete',
                        message: 'Select conversations to DELETE (use spacebar, press Enter when done):',
                        choices: existingConversations,
                        loop: false,
                        validate: (answer) => {
                            // Optional: Could add validation (e.g., ensure at least one is selected)
                            // if (answer.length < 1) {
                            //     return 'You must choose at least one conversation.';
                            // }
                            return true;
                        },
                    },
                ]);

                if (!conversationsToDelete || conversationsToDelete.length === 0) {
                    console.log(chalk.yellow("No conversations selected for deletion."));
                    return null;
                }

                // Ask for confirmation
                const { confirmDelete } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'confirmDelete',
                        message: `Are you sure you want to permanently delete the following ${conversationsToDelete.length} conversation(s)?\n- ${conversationsToDelete.join('\n- ')}`,
                        default: false,
                    },
                ]);

                if (confirmDelete) {
                    return { mode, conversationNamesToDelete: conversationsToDelete }; // Return the array
                } else {
                    console.log(chalk.yellow("Deletion cancelled."));
                    return null; // User aborted confirmation
                }
            }

            // --- Handle Other Modes (Start/Continue, Consolidate) ---
            // Model selection is only relevant for conversation/consolidation
            let selectedModel = this.config.gemini.model_name || "gemini-2.5-pro-preview-03-25"; // Default
            const { modelChoice } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'modelChoice',
                    message: 'Select the AI model to use for this operation:',
                    choices: [
                        { name: `Gemini 2.5 Pro (Slower, Powerful)`, value: 'gemini-2.5-pro-preview-03-25' },
                        { name: `Gemini 2.0 Flash (Faster, Lighter)`, value: 'gemini-2.0-flash' },
                    ],
                    default: this.config.gemini.model_name,
                },
            ]);
            selectedModel = modelChoice;

            let conversationDetails: { name: string; isNew: boolean } | null = null;
            let conversationName: string | null = null;
            let isNewConversation = false;

            conversationDetails = await this.selectOrCreateConversation();
            if (mode === 'Consolidate Changes...' && conversationDetails.isNew) {
                console.error(chalk.red("Error: Cannot consolidate changes for a newly created (empty) conversation."));
                return null;
            }
            conversationName = conversationDetails.name;
            isNewConversation = conversationDetails.isNew;

            // Return based on mode (already handled Delete above)
            if (mode === 'Start/Continue Conversation') {
                 if (!conversationName) { // Add null check for safety
                    console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                    return null;
                 }
                return { mode, conversationName: conversationName, isNewConversation: isNewConversation, selectedModel: selectedModel };
            } else if (mode === 'Consolidate Changes...') {
                 // Ensure conversationName is not null before returning
                 if (!conversationName) {
                    console.error(chalk.red("Internal Error: Conversation name missing for Consolidation mode."));
                    return null;
                 }
                return { mode, conversationName: conversationName, isNewConversation: false, selectedModel: selectedModel };
            } else {
                // Should not be reached as Delete is handled, but good practice
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