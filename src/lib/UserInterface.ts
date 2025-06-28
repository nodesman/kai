// File: src/lib/UserInterface.ts
import inquirer from 'inquirer';
import { spawn, SpawnOptionsWithoutStdio } from 'child_process'; // Import SpawnOptions
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

    constructor(config: Config) {
        this.fs = new FileSystem();
        this.config = config;
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

    // --- getPromptViaSublimeLoop (Unchanged from provided context) ---
    async getPromptViaSublimeLoop(
        conversationName: string,
        currentMessages: Message[],
        editorFilePath: string,
        isFallbackAttempt = false // Added flag to prevent infinite loops
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

        // --- Editor Detection Logic ---
        let editorCommand = 'subl'; // Default to Sublime Text
        let editorArgs = ['-w', editorFilePath];
        let editorName = 'Sublime Text';

        if (process.platform === 'darwin' && !isFallbackAttempt) { // Only detect IDE if not already a fallback
            const bundleId = process.env.__CFBundleIdentifier;
            if (bundleId === 'com.jetbrains.WebStorm') {
                editorCommand = 'webstorm';
                editorArgs = ['--wait', editorFilePath];
                editorName = 'WebStorm';
                console.log(chalk.blue(`Detected running inside WebStorm (macOS). Using '${editorCommand}' command...`));
            } else if (bundleId === 'com.jetbrains.CLion') {
                editorCommand = 'clion';
                editorArgs = ['--wait', editorFilePath];
                editorName = 'CLion';
                console.log(chalk.blue(`Detected running inside CLion (macOS). Using '${editorCommand}' command...`));
            } else if (bundleId === 'com.jetbrains.intellij') { // <<<--- ADDED INTELLIJ DETECTION
                editorCommand = 'idea'; // Assumes 'idea' command-line launcher is installed and in PATH
                editorArgs = ['--wait', editorFilePath]; // Use --wait flag
                editorName = 'IntelliJ IDEA';
                console.log(chalk.blue(`Detected running inside IntelliJ IDEA (macOS). Using '${editorCommand}' command...`));
            }
             // Add more else if for other JetBrains IDEs (e.g., GoLand, PyCharm) if needed
             // else if (bundleId === 'com.jetbrains.goland') { editorCommand = 'goland'; ... }
             // else if (bundleId === 'com.jetbrains.pycharm') { editorCommand = 'charm'; ... }
        }
        // TODO: Add detection for other platforms (Windows, Linux) if possible
        //       - Windows might check for env vars like WT_SESSION or specific paths.
        //       - Linux might check TERMINAL_EMULATOR or other DE-specific vars.
        // --- End Editor Detection Logic ---

        console.log(`\nOpening conversation "${conversationName}" in ${editorName}...`);
        console.log(`(Type your prompt above the '${HISTORY_SEPARATOR}', save, and close the editor tab/window to send)`);
        console.log(`(Close without saving OR save without changes to exit conversation)`);

        let exitCode: number | null = null;
        let processError: Error | FallbackError | null = null;

        try {
            const editorProcess = spawn(editorCommand, editorArgs, { stdio: 'inherit' });

            exitCode = await new Promise<number | null>((resolve, reject) => {
                editorProcess.on('close', (code) => resolve(code));
                editorProcess.on('error', (error) => {
                    if ((error as any).code === 'ENOENT') {
                        const errorMsg = `❌ Error: '${editorCommand}' command not found.`;
                        // --- Modified Check for JetBrains IDEs ---
                        const isJetBrainsLauncher = ['webstorm', 'clion', 'idea'].includes(editorCommand); // Add other launchers here if supported

                        if (isJetBrainsLauncher && !isFallbackAttempt) { // Check if IDE launcher failed and not already a fallback
                            console.error(chalk.red(`\n${errorMsg} Ensure the JetBrains IDE command-line launcher ('${editorCommand}') is created (Tools -> Create Command-line Launcher...) and its directory is in your system's PATH.`));
                            console.warn(chalk.yellow(`Falling back to 'subl'...`));
                            // Reject with a special object to trigger fallback
                            reject({ type: 'fallback', editor: 'subl', args: ['-w', editorFilePath] } as FallbackError);
                        } else { // Sublime failed or it was already a fallback attempt
                            console.error(chalk.red(`\n${errorMsg} Make sure ${editorName} is installed and '${editorCommand}' is in your system's PATH.`));
                            reject(new Error(`'${editorCommand}' command not found.'`)); // Reject with standard error
                        }
                        // --- End Modified Check ---
                    } else {
                        console.error(chalk.red(`\n❌ Error spawning ${editorName}:`), error);
                        reject(error); // Reject with the original spawn error
                    }
                });
            });
        } catch (err: any) {
             // Catch the rejection from the promise (including fallback object)
             processError = err;
        }

         // --- Handle Fallback ---
         if (processError && (processError as FallbackError).type === 'fallback') {
             console.log(chalk.blue(`Attempting to open with fallback editor: ${(processError as FallbackError).editor}...`));
             // Recursive call with fallback flag set to true
             return this.getPromptViaSublimeLoop(conversationName, currentMessages, editorFilePath, true);
         } else if (processError) {
              // If it was a standard error caught, re-throw it to be handled by the main catch block
              throw processError;
         }
         // --- End Handle Fallback ---

        if (exitCode !== 0) {
            console.warn(chalk.yellow(`\n${editorName} process closed with non-zero code: ${exitCode}. Assuming exit.`));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        // --- File reading and prompt extraction (remains the same) ---
        let modifiedContent: string;
        try {
            await fs.access(editorFilePath); // Check existence first
            modifiedContent = await this.fs.readFile(editorFilePath) || ''; // Read content
        } catch (readError) {
            if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
                // This case might happen if the --wait flag didn't work as expected or the file was deleted manually
                console.warn(chalk.yellow(`\nEditor file ${editorFilePath} not found after closing ${editorName}. Assuming exit.`));
                return { newPrompt: null, conversationFilePath, editorFilePath };
            }
            // Rethrow other read errors
            console.error(chalk.red(`\nError reading editor file ${editorFilePath} after closing:`), readError);
            throw readError;
        }

        const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');

        if (initialHash === modifiedHash) {
            console.log(chalk.blue(`\nNo changes detected in ${editorName}. Exiting conversation.`));
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
                await this.fs.ensureKaiDirectoryExists(this.config.chatsDir);
                const existingConversations = await this.fs.listJsonlFiles(this.config.chatsDir);

                if (existingConversations.length === 0) {
                    console.log(chalk.yellow("No conversations found to delete."));
                    return null;
                }

                const { conversationsToDelete } = await inquirer.prompt<{ conversationsToDelete: string[] }>([
                    {
                        type: 'checkbox',
                        name: 'conversationsToDelete',
                        message: 'Select conversations to DELETE (use spacebar, press Enter when done):',
                        choices: existingConversations,
                        loop: false,
                        validate: (answer) => {
                            return true;
                        },
                    },
                ]);

                if (!conversationsToDelete || conversationsToDelete.length === 0) {
                    console.log(chalk.yellow("No conversations selected for deletion."));
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
                    return { mode, conversationNamesToDelete: conversationsToDelete };
                } else {
                    console.log(chalk.yellow("Deletion cancelled."));
                    return null;
                }
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
                const { directoryName } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'directoryName',
                        message: 'Project directory name:',
                        validate: (input) => input.trim() ? true : 'Directory name cannot be empty.'
                    }
                ]);
                const { language } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'language',
                        message: 'Select primary language:',
                        choices: ['TypeScript', 'JavaScript']
                    }
                ]);
                const { framework } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'framework',
                        message: 'Select framework:',
                        choices: ['Node', 'None']
                    }
                ]);
                return { mode: 'Scaffold New Project', language, framework, directoryName };
            }

            // --- Handle Harden Mode ---
            if (mode === 'Harden') {
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
                    }
                ]);
                return { mode: 'Harden', tool: toolChoice.toLowerCase() as 'jest' };
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
