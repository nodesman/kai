// File: src/lib/UserInterface.ts
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs/promises'; // Use fs.promises for async operations
import { FileSystem } from './FileSystem';
import { toSnakeCase } from './utils'; // Import the utility function
import { Config } from './Config'; // Import Config
import Conversation, { Message } from './models/Conversation'; // Import Conversation types
import chalk from 'chalk'; // Import chalk for logging
import { PromptEditor, HISTORY_SEPARATOR } from './UserInteraction/PromptEditor';

// Define the expected return type for getUserInteraction
interface UserInteractionResultBase {
    mode:
        | 'Start/Continue Conversation'
        | 'Consolidate Changes...'
        | 'Re-run Project Analysis' // Added Re-run option
        | 'Change Context Mode'
        | 'Scaffold New Project'; // Added scaffold mode
    conversationName: string | null; // Used for conversation ops
    isNewConversation: boolean; // Relevant only for Start/Continue
    selectedModel: string;
}

interface DeleteInteractionResult {
    mode: 'Delete Conversation...';
    conversationNamesToDelete: string[]; // Array of names to delete
}

// Added specific result type for changing mode
interface ChangeModeInteractionResult {
    mode: 'Change Context Mode';
    newMode: 'full' | 'analysis_cache' | 'dynamic'; // Added dynamic mode
}

interface ScaffoldProjectInteractionResult {
    mode: 'Scaffold New Project';
    language: string;
    framework: string;
    directoryName: string;
}

interface HardenInteractionResult {
    mode: 'Harden';
    tool: 'jest';
    selectedModel: string;
}

// Define the structure for the fallback error
interface FallbackError {
    type: 'fallback';
    editor: string;
    args: string[];
}

// Combined result types
type UserInteractionResult =
    | UserInteractionResultBase
    | DeleteInteractionResult
    | ChangeModeInteractionResult
    | ScaffoldProjectInteractionResult
    | HardenInteractionResult;

class UserInterface {
    fs: FileSystem;
    config: Config;
    promptEditor: PromptEditor;

    constructor(config: Config) {
        this.fs = new FileSystem();
        this.config = config;
        this.promptEditor = new PromptEditor(this.fs, this.config);
    }

    // --- confirmInitialization (Unchanged) ---
    async confirmInitialization(directoryPath: string, isDirectorySafe: boolean): Promise<boolean> {
        const message = isDirectorySafe
            ? `The directory '${directoryPath}' is not a Git repository but appears empty or safe.\nDo you want Kai to initialize Git, create the '.kai/logs' directory, and configure '.gitignore'?`
            : `The directory '${directoryPath}' is not a Git repository and contains existing files.\nInitializing Git here will affect these files.\nDo you want Kai to initialize Git, create the '.kai/logs' directory, and configure '.gitignore'?`;

        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
            {
                type: 'confirm',
                name: 'confirm',
                message: message,
                default: false,
            },
        ]);
        return confirm;
    }

    /** Display a list of changed files. */
    displayChangedFiles(files: string[]): void {
        if (files.length === 0) return;
        console.log(chalk.cyan('\nModified files:'));
        files.forEach(f => console.log('  - ' + f));
    }

    /** Ask the user whether Kai should generate and commit the changes. */
    async promptGenerateCommit(): Promise<boolean> {
        const { commit } = await inquirer.prompt<{ commit: boolean }>([
            {
                type: 'confirm',
                name: 'commit',
                message: 'Generate commit message with Gemini and commit all changes?',
                default: true,
            },
        ]);
        return commit;
    }

    /** Confirm the proposed commit message before committing. */
    async confirmCommitMessage(message: string): Promise<boolean> {
        console.log(chalk.blue('\nProposed commit message:\n')); 
        console.log(message + '\n');
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
            {
                type: 'confirm',
                name: 'confirm',
                message: 'Use this commit message?',
                default: true,
            },
        ]);
        return confirm;
    }

    // --- selectOrCreateConversation (Unchanged) ---
    async selectOrCreateConversation(): Promise<{ name: string; isNew: boolean }> {
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

    private async _detectJest(): Promise<boolean> {
        const pkgPath = path.join(process.cwd(), 'package.json');
        try {
            const pkgRaw = await fs.readFile(pkgPath, 'utf8');
            const pkg = JSON.parse(pkgRaw);
            const deps = Object.keys(pkg.dependencies || {});
            const dev = Object.keys(pkg.devDependencies || {});
            if (deps.includes('jest') || dev.includes('jest')) return true;
        } catch {}
        try {
            await fs.access(path.join(process.cwd(), 'jest.config.js'));
            return true;
        } catch {}
        return false;
    }

    private async _handleDeletion(): Promise<DeleteInteractionResult | null> {
        await this.fs.ensureKaiDirectoryExists(this.config.chatsDir);
        const existingConversations = await this.fs.listJsonlFiles(this.config.chatsDir);
        if (existingConversations.length === 0) {
            console.log(chalk.yellow('No conversations found to delete.'));
            return null;
        }
        const { conversationsToDelete } = await inquirer.prompt<{ conversationsToDelete: string[] }>([
            {
                type: 'checkbox',
                name: 'conversationsToDelete',
                message: 'Select conversations to DELETE (use spacebar, press Enter when done):',
                choices: existingConversations,
                loop: false,
                validate: () => true,
            },
        ]);

        if (!conversationsToDelete || conversationsToDelete.length === 0) {
            console.log(chalk.yellow('No conversations selected for deletion.'));
            return null;
        }

        const { confirmDelete } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirmDelete',
                message: `Are you sure you want to permanently delete the following ${conversationsToDelete.length} conversation(s)?\n- ${conversationsToDelete.join('\n- ')}`,
                default: false,
            },
        ]);
        if (confirmDelete) {
            return { mode: 'Delete Conversation...', conversationNamesToDelete: conversationsToDelete };
        } else {
            console.log(chalk.yellow('Deletion cancelled.'));
            return null;
        }
    }

    private async _handleScaffold(): Promise<ScaffoldProjectInteractionResult> {
        const { directoryName } = await inquirer.prompt([
            {
                type: 'input',
                name: 'directoryName',
                message: 'Project directory name:',
                validate: input => (input.trim() ? true : 'Directory name cannot be empty.'),
            },
        ]);
        const { language } = await inquirer.prompt([
            {
                type: 'list',
                name: 'language',
                message: 'Select primary language:',
                choices: ['TypeScript', 'JavaScript'],
            },
        ]);
        const { framework } = await inquirer.prompt([
            {
                type: 'list',
                name: 'framework',
                message: 'Select framework:',
                choices: ['Node', 'None'],
            },
        ]);
        return { mode: 'Scaffold New Project', language, framework, directoryName };
    }

    private async _handleHarden(): Promise<HardenInteractionResult | null> {
        const frameworks: string[] = [];
        if (await this._detectJest()) frameworks.push('Jest');
        if (frameworks.length === 0) {
            console.log(chalk.yellow('No supported test frameworks detected.'));
            return null;
        }
        const { toolChoice } = await inquirer.prompt([
            {
                type: 'list',
                name: 'toolChoice',
                message: 'Select test framework:',
                choices: frameworks,
            },
        ]);
        const primaryModel = this.config.gemini.model_name;
        const secondaryModel = this.config.gemini.subsequent_chat_model_name;
        const modelChoices = [
            {
                name: `Primary Model (${primaryModel}) - Recommended for complex tasks / generation`,
                value: primaryModel,
            },
            {
                name: `Secondary Model (${secondaryModel}) - Recommended for quick interactions / analysis`,
                value: secondaryModel,
            },
        ];
        const { modelChoice } = await inquirer.prompt([
            {
                type: 'list',
                name: 'modelChoice',
                message: 'Select the AI model to use for this operation:',
                choices: modelChoices,
                default: primaryModel,
            },
        ]);
        return { mode: 'Harden', tool: toolChoice.toLowerCase() as 'jest', selectedModel: modelChoice };
    }

    formatHistoryForSublime(messages: Message[]): string {
        return this.promptEditor.formatHistoryForSublime(messages);
    }

    extractNewPrompt(fullContent: string): string | null {
        return this.promptEditor.extractNewPrompt(fullContent);
    }

    async getPromptViaSublimeLoop(
        conversationName: string,
        currentMessages: Message[],
        editorFilePath: string,
        isFallbackAttempt = false
    ): Promise<{ newPrompt: string | null; conversationFilePath: string; editorFilePath: string }> {
        return this.promptEditor.getPromptViaSublimeLoop(conversationName, currentMessages, editorFilePath, isFallbackAttempt);
    }

    // --- getUserInteraction (MODIFIED) ---
    async getUserInteraction(): Promise<UserInteractionResult | null> {
        try {
            const { mode } = await inquirer.prompt<{ mode: UserInteractionResult['mode'] | 'Exit Kai' }>([ // Add 'Exit Kai' to type
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Select a mode:',
                    choices: [
                        'Start/Continue Conversation',
                        'Consolidate Changes...',
                        'Harden',
                        'Re-run Project Analysis',
                        'Change Context Mode',
                        'Scaffold New Project',
                        'Delete Conversation...',
                        'Exit Kai', // <-- ADDED Exit option
                        // REMOVED: 'View Kanban Board' option
                    ],
                },
            ]);

             // --- ADDED: Handle Exit Kai ---
             if (mode === 'Exit Kai') {
                console.log(chalk.blue("\nExiting Kai..."));
                return null; // Signal to the main loop to exit
             }
             // --- END Handle Exit Kai ---

            if (mode === 'Delete Conversation...') {
                return await this._handleDeletion();
            }

            // --- Handle Re-run Project Analysis Mode ---
            if (mode === 'Re-run Project Analysis') {
                // No conversation name or model needed for analysis
                return { mode, conversationName: null, isNewConversation: false, selectedModel: '' }; // Return minimal info
            }

            // --- Handle Change Context Mode ---
            if (mode === 'Change Context Mode') {
                const currentMode = this.config.context.mode || 'Undetermined'; // Get current mode
                const { newModeChoice } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'newModeChoice',
                        message: `Current context mode is '${currentMode}'. Select the new mode:`,
                        choices: [
                            { name: 'Full Codebase (reads all files)', value: 'full' },
                            { name: 'Analysis Cache (uses summaries)', value: 'analysis_cache' },
                            { name: 'Dynamic (AI selects relevant files)', value: 'dynamic' }, // <-- ADDED Dynamic option
                        ],
                    },
                ]);
                // Return specific result type for changing mode
                return {
                    mode: 'Change Context Mode',
                    newMode: newModeChoice as 'full' | 'analysis_cache' | 'dynamic',
                };
            }

            // --- Handle Scaffold New Project ---
            if (mode === 'Scaffold New Project') {
                return await this._handleScaffold();
            }

            // --- Handle Harden Mode ---
            if (mode === 'Harden') {
                return await this._handleHarden();
            }

            // --- Remaining modes require Model selection ---
            const primaryModel = this.config.gemini.model_name; // Already guaranteed to be a string by Config.ts
            const secondaryModel = this.config.gemini.subsequent_chat_model_name; // Already guaranteed to be a string

            const modelChoices = [
                {
                    name: `Primary Model (${primaryModel}) - Recommended for complex tasks / generation`,
                    value: primaryModel
                },
                {
                    name: `Secondary Model (${secondaryModel}) - Recommended for quick interactions / analysis`,
                    value: secondaryModel
                },
            ];

            const { modelChoice } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'modelChoice',
                    message: 'Select the AI model to use for this operation:',
                    choices: modelChoices,
                    default: primaryModel, // Default to the currently configured primary model
                },
            ]);
            const selectedModel = modelChoice;

            // --- Remaining modes require Conversation Selection ---
            let conversationDetails: { name: string; isNew: boolean } | null = null;
            let conversationName: string | null = null;
            let isNewConversation = false;

            await this.fs.ensureKaiDirectoryExists(this.config.chatsDir);
            conversationDetails = await this.selectOrCreateConversation();
            if (mode === 'Consolidate Changes...' && conversationDetails.isNew) {
                console.error(chalk.red("Error: Cannot consolidate changes for a newly created (empty) conversation."));
                return null;
            }
            conversationName = conversationDetails.name;
            isNewConversation = conversationDetails.isNew;

            if (mode === 'Start/Continue Conversation') {
                 if (!conversationName) {
                    console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                    return null;
                 }
                return { mode, conversationName: conversationName, isNewConversation: isNewConversation, selectedModel: selectedModel };
            } else if (mode === 'Consolidate Changes...') {
                 if (!conversationName) {
                    console.error(chalk.red("Internal Error: Conversation name missing for Consolidation mode."));
                    return null;
                 }
                return { mode, conversationName: conversationName, isNewConversation: false, selectedModel: selectedModel };
            } else {
                console.warn(chalk.yellow(`Unhandled mode selection: ${mode}`));
                return null;
            }

        } catch (error) {
             // Catch block remains largely the same, but the error might originate from the editor spawn failure
            if ((error as any).isTtyError) {
                console.error(chalk.red("\nPrompt couldn't be rendered in this environment."));
            } else {
                 // Check if it's the fallback error object we created (it shouldn't reach here if handled correctly)
                 if (error && (error as FallbackError).type === 'fallback') {
                     console.error(chalk.red('\nInternal Error: Fallback error was not handled correctly.'));
                 }
                 // Check for the standard editor command not found error
                 else if (error instanceof Error && error.message.includes('command not found')) {
                     console.error(chalk.red(`\nEditor Interaction Error: ${error.message}`));
                     console.error(chalk.yellow('Please ensure your chosen editor command (subl, webstorm, clion, idea, etc.) is configured correctly in your PATH.'));
                 }
                 // Handle other general errors
                 else {
                    console.error(chalk.red('\nError during user interaction:'), error);
                 }
            }
            return null;
        }
    }
}

export {
    UserInterface,
    UserInteractionResult,
    ChangeModeInteractionResult,
    ScaffoldProjectInteractionResult,
    HardenInteractionResult
};
