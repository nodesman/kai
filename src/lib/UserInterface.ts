// File: src/lib/UserInterface.ts
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs/promises'; // Use fs.promises for async operations
import yaml from 'js-yaml'; // Import js-yaml for output formatting
import { FileSystem } from './FileSystem';
import { toSnakeCase } from './utils'; // Import the utility function
import { Config } from './Config'; // Import Config
import { Message } from './models/Conversation'; // Import Conversation types (just Message needed now)
import chalk from 'chalk'; // Import chalk for logging
import { ScopeUIManager } from './ui/ScopeUIManager';
import { SublimeEditorInteraction, EditorInteractionResult } from './ui/SublimeEditorInteraction';
import { ScopeManager, Scope } from './ScopeManager';

// Define the expected return type for modes needing conversation context
interface UserInteractionResult {
    mode: 'Start/Continue Conversation' | 'Consolidate Changes...' | 'Delete Conversation...';
    conversationName: string | null; // Used for conversation ops AND deletion target
    isNewConversation: boolean; // Relevant only for Start/Continue
    selectedModel: string; // Add the selected model here
}

// Define types for the new management modes
type ManageScopesMode = { mode: 'Manage Scopes' };
type SuggestScopesMode = { mode: 'Suggest Scopes' }; // Keep Suggest Scopes separate if also accessible directly
type ExitMode = null;

// Union type for all possible return values of getUserInteraction
type InteractionResult = UserInteractionResult | ManageScopesMode | SuggestScopesMode | ExitMode;

// Type for suggested scopes (can reuse Scope if suitable) - *Removed, now internal to ScopeUIManager*
// interface SuggestedScope extends Scope {}

class UserInterface {
    fs: FileSystem;
    config: Config;
    projectRoot: string;
    scopeManager: ScopeManager; // Keep for dependency injection
    // --- Instantiate Extracted UI Handlers ---
    private scopeUIManager: ScopeUIManager;
    private sublimeEditorInteraction: SublimeEditorInteraction;
    // --- End Instantiate Extracted UI Handlers ---

    constructor(config: Config) { // Accept config
        this.fs = new FileSystem();
        this.config = config;
        this.projectRoot = process.cwd();
        // --- Instantiate Managers ---
        this.scopeManager = new ScopeManager(config, this.fs);
        this.scopeUIManager = new ScopeUIManager(this.scopeManager, config, this.fs, this.projectRoot);
        this.sublimeEditorInteraction = new SublimeEditorInteraction(this.fs, config);
        // --- End Instantiate Managers ---
    }

    // --- selectOrCreateConversation (Unchanged) ---
    async selectOrCreateConversation(): Promise<{ name: string; isNew: boolean }> {
        await this.fs.ensureDirExists(this.config.chatsDir);
        const existingConversations = await this.fs.listJsonlFiles(this.config.chatsDir);
        const choices = [...existingConversations, new inquirer.Separator(), '<< Create New Conversation >>'];
        const { selected } = await inquirer.prompt([
             { type: 'list', name: 'selected', message: 'Select or create conversation:', choices: choices, loop: false }
        ]);
        if (selected === '<< Create New Conversation >>') {
            const { newName } = await inquirer.prompt([
                { type: 'input', name: 'newName', message: 'New conversation name:', validate: (i) => !!i.trim(), filter: (i) => i.trim() }
            ]);
            // Use utility function for consistency
            const snakeName = toSnakeCase(newName);
            if (existingConversations.includes(snakeName)) {
                console.warn(chalk.yellow(`Warning: Conversation "${snakeName}" exists. Reusing.`));
                // Return the snake_case name for consistency
                return { name: snakeName, isNew: false };
            }
             // Return the original name provided by user for display, but snake_case is used internally for files
             // Decision: Let's consistently use the user-provided name externally and snake_case internally where needed.
             // CodeProcessor needs the name as provided here.
            return { name: newName, isNew: true };
        } else {
            // Selected is already the snake_case name from listJsonlFiles
            return { name: selected, isNew: false };
        }
    }

    // --- selectConversationToDelete (Unchanged) ---
    async selectConversationToDelete(): Promise<string | null> {
        await this.fs.ensureDirExists(this.config.chatsDir);
        const existingConversations = await this.fs.listJsonlFiles(this.config.chatsDir);
        if (existingConversations.length === 0) {
             console.log(chalk.yellow("No conversations to delete.")); return null;
        }
        // Choices are snake_case names
        const choices = [...existingConversations, new inquirer.Separator(), '[ Cancel ]'];
        const { selected } = await inquirer.prompt([
             { type: 'list', name: 'selected', message: 'Select conversation to DELETE:', choices: choices, loop: false }
        ]);
        if (selected === '[ Cancel ]') {
            return null;
        }
        // Return the selected snake_case name
        return selected;
    }

    // --- formatHistoryForSublime (REMOVED - Logic moved to SublimeEditorInteraction) ---
    // --- extractNewPrompt (REMOVED - Logic moved to SublimeEditorInteraction) ---
    // --- HISTORY_SEPARATOR (REMOVED - Constant moved to SublimeEditorInteraction) ---

    // --- getPromptViaSublimeLoop (MODIFIED - Now uses SublimeEditorInteraction) ---
    /**
     * Orchestrates getting user input via Sublime Text.
     * It uses the SublimeEditorInteraction class for the core editor logic
     * and constructs the return object expected by CodeProcessor.
     */
    async getPromptViaSublimeLoop(
        conversationName: string, // User-provided or selected name
        currentMessages: Message[],
        editorFilePath: string // The exact path CodeProcessor determined
    ): Promise<{ newPrompt: string | null; conversationFilePath: string; editorFilePath: string }> {
        // Determine conversation file path (consistent with CodeProcessor)
        const snakeName = toSnakeCase(conversationName);
        const conversationFileName = `${snakeName}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);

        // Delegate the core editor interaction
        const editorResult: EditorInteractionResult = await this.sublimeEditorInteraction.getPrompt(
            conversationName, // Pass the original name for potential display/logging within interaction
            currentMessages
        );

        // Construct the object CodeProcessor expects, including the paths
        return {
            newPrompt: editorResult.newPrompt,
            conversationFilePath: conversationFilePath,
            editorFilePath: editorFilePath // Return the path CodeProcessor provided
        };
    }

    // --- getUserInteraction (MODIFIED - Delegates scope actions) ---
    async getUserInteraction(): Promise<InteractionResult> { // Return the union type
        try {
            const { mode } = await inquirer.prompt<{ mode: UserInteractionResult['mode'] | 'Manage Scopes' | 'Suggest Scopes' | '[ Exit ]' }>([
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Select a mode:',
                    choices: [
                        'Start/Continue Conversation',
                        'Consolidate Changes...',
                        'Delete Conversation...',
                        new inquirer.Separator(),
                        'Manage Scopes',
                        'Suggest Scopes',
                        new inquirer.Separator(),
                        '[ Exit ]',
                    ],
                },
            ]);

            // Handle exit and modes that don't need further prompts here
            if (mode === '[ Exit ]') return null;

            // --- DELEGATE Scope Actions ---
            if (mode === 'Manage Scopes') {
                // Delegate to ScopeUIManager and then return null to signify completion of the action
                // The main loop in kai.ts will handle this return value
                await this.scopeUIManager.runManageScopes();
                return { mode: 'Manage Scopes' }; // Signal that this mode was handled
            }
            if (mode === 'Suggest Scopes') {
                // Delegate to ScopeUIManager and return null
                await this.scopeUIManager.runSuggestScopes();
                return { mode: 'Suggest Scopes' }; // Signal that this mode was handled
            }
            // --- END DELEGATION ---

            // --- Logic for Conversation Modes (Largely Unchanged) ---
            let selectedModel = this.config.gemini.model_name || "gemini-2.5-pro-exp-03-25";
            if (mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...') {
                const { modelChoice } = await inquirer.prompt([
                     { type: 'list', name: 'modelChoice', message: 'Select AI model:', choices: [
                          { name: `Gemini 2.5 Pro (Slower, Powerful)`, value: 'gemini-2.5-pro-exp-03-25' },
                          { name: `Gemini 2.0 Flash (Faster, Lighter)`, value: 'gemini-2.0-flash' },
                     ], default: this.config.gemini.model_name }
                ]);
                selectedModel = modelChoice;
            }

            let conversationName: string | null = null;
            let isNewConversation = false;
            if (mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...') {
                // selectOrCreateConversation returns the user-provided name or selected snake_case name
                const conversationDetails = await this.selectOrCreateConversation();
                if (mode === 'Consolidate Changes...' && conversationDetails.isNew) {
                     console.error(chalk.red("Error: Cannot consolidate new (empty) conversation. Please start the conversation first."));
                     return null; // Exit if trying to consolidate a new convo
                }
                conversationName = conversationDetails.name; // This name is passed to CodeProcessor
                isNewConversation = conversationDetails.isNew;
            } else if (mode === 'Delete Conversation...') {
                // selectConversationToDelete returns the snake_case name
                const nameToDelete = await this.selectConversationToDelete();
                if (!nameToDelete) { console.log(chalk.yellow("Deletion cancelled.")); return null; }
                const { confirmDelete } = await inquirer.prompt([
                     // Display the snake_case name in confirmation
                     { type: 'confirm', name: 'confirmDelete', message: `Are you sure you want to permanently delete the conversation '${nameToDelete}'?`, default: false }
                ]);
                if (confirmDelete) {
                     conversationName = nameToDelete; // Use the snake_case name for deletion logic
                } else {
                     console.log(chalk.yellow("Deletion cancelled.")); return null;
                }
            }

            // Return result based on mode
            if ((mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...' || mode === 'Delete Conversation...') && !conversationName) {
                 console.error(chalk.red(`Internal error: Missing conversation name for mode "${mode}". Interaction cancelled.`));
                 return null; // Exit on internal error
            }

            // Ensure the correct type is returned for each conversation mode
            if (mode === 'Start/Continue Conversation') {
                return { mode, conversationName: conversationName!, isNewConversation: isNewConversation, selectedModel: selectedModel };
            } else if (mode === 'Consolidate Changes...') {
                // conversationName will be the user-provided or selected snake_case name
                return { mode, conversationName: conversationName!, isNewConversation: false, selectedModel: selectedModel };
            } else if (mode === 'Delete Conversation...') {
                // conversationName will be the selected snake_case name
                return { mode, conversationName: conversationName!, isNewConversation: false, selectedModel: selectedModel };
            } else {
                // This case should not be reachable due to earlier checks
                console.warn(chalk.yellow(`Unhandled mode selection reached end: ${mode}`)); return null;
            }

        } catch (error) {
            if ((error as any).isTtyError) { console.error(chalk.red("Prompt unavailable in this environment.")); }
            else { console.error(chalk.red('\nError during user interaction:'), error); }
            return null; // Exit on any error during interaction
        }
    }
}

// Export necessary types along with the class
export { UserInterface, UserInteractionResult, InteractionResult };