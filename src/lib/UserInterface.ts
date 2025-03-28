// File: src/lib/UserInterface.ts
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises'; // Use fs.promises for async operations
import crypto from 'crypto'; // For checking file changes
import yaml from 'js-yaml'; // Import js-yaml for output formatting
import { FileSystem } from './FileSystem';
import { toSnakeCase } from './utils'; // Import the utility function
import { Config } from './Config'; // Import Config
import Conversation, { Message } from './models/Conversation'; // Import Conversation types
import chalk from 'chalk'; // Import chalk for logging
// --- Import ScopeManager and Scope type ---
import { ScopeManager, Scope } from './ScopeManager';
// --- End Import ---


const HISTORY_SEPARATOR = '--- TYPE YOUR PROMPT ABOVE THIS LINE ---';

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

// Type for suggested scopes (can reuse Scope if suitable)
interface SuggestedScope extends Scope {}

class UserInterface {
    fs: FileSystem;
    config: Config; // Add config
    projectRoot: string; // Add project root
    scopeManager: ScopeManager; // Add ScopeManager instance

    constructor(config: Config) { // Accept config
        this.fs = new FileSystem();
        this.config = config; // Store config
        this.projectRoot = process.cwd(); // Store project root
        this.scopeManager = new ScopeManager(config, this.fs); // Instantiate ScopeManager
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
            const snakeName = toSnakeCase(newName);
            if (existingConversations.includes(snakeName)) {
                console.warn(chalk.yellow(`Warning: Conversation "${snakeName}" exists. Reusing.`));
                return { name: snakeName, isNew: false };
            }
            return { name: newName, isNew: true };
        } else {
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
        const choices = [...existingConversations, new inquirer.Separator(), '[ Cancel ]'];
        const { selected } = await inquirer.prompt([
             { type: 'list', name: 'selected', message: 'Select conversation to DELETE:', choices: choices, loop: false }
        ]);
        if (selected === '[ Cancel ]') {
            return null;
        }
        // Return the selected name (which is the base name without .jsonl)
        return selected;
    }

    // --- formatHistoryForSublime (Unchanged) ---
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

    // --- extractNewPrompt (Unchanged) ---
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

    // --- getPromptViaSublimeLoop (Unchanged) ---
    async getPromptViaSublimeLoop(
        conversationName: string,
        currentMessages: Message[],
        editorFilePath: string // <<< ADD this parameter
    ): Promise<{ newPrompt: string | null; conversationFilePath: string; editorFilePath: string }> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        // const editorFileName = `${toSnakeCase(conversationName)}_edit.txt`; // <<< REMOVE or comment out
        // const editorFilePath = path.join(this.config.chatsDir, editorFileName); // <<< REMOVE or comment out (now passed as argument)

        const contentToWrite = this.formatHistoryForSublime(currentMessages || []);
        const initialHash = crypto.createHash('sha256').update(contentToWrite).digest('hex');

        try {
            // Use the passed editorFilePath
            await this.fs.writeFile(editorFilePath, contentToWrite);
        } catch (writeError) {
            console.error(`Error writing temporary edit file ${editorFilePath}:`, writeError);
            throw writeError;
        }

        console.log(`\nOpening conversation "${conversationName}" in Sublime Text...`);
        console.log(`(Type your prompt above the '${HISTORY_SEPARATOR}', save, and close Sublime to send)`);
        console.log(`(Close without saving OR save without changes to exit conversation)`);

        // Use the passed editorFilePath
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
            // Return the passed editorFilePath
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        let modifiedContent: string;
        try {
            // Use the passed editorFilePath
            await fs.access(editorFilePath);
            modifiedContent = await this.fs.readFile(editorFilePath) || '';
        } catch (readError) {
            if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(chalk.yellow(`\nEditor file ${editorFilePath} not found after closing Sublime. Assuming exit.`));
                // Return the passed editorFilePath
                return { newPrompt: null, conversationFilePath, editorFilePath };
            }
            console.error(chalk.red(`\nError reading editor file ${editorFilePath} after closing:`), readError);
            throw readError;
        }

        const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');

        if (initialHash === modifiedHash) {
            console.log(chalk.blue("\nNo changes detected in Sublime Text. Exiting conversation."));
            // Return the passed editorFilePath
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        const newPrompt = this.extractNewPrompt(modifiedContent);

        if (newPrompt === null) {
            console.log(chalk.blue("\nNo new prompt entered. Exiting conversation."));
            // Return the passed editorFilePath
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        console.log(chalk.green("\nPrompt received, processing with AI..."));
        // Return the passed editorFilePath
        return { newPrompt: newPrompt, conversationFilePath, editorFilePath };
    }

    // --- getUserInteraction (MODIFIED) ---
    async getUserInteraction(): Promise<InteractionResult> { // Return the union type
        try {
            // --- MODIFIED: Add new modes to choices ---
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
                        'Manage Scopes', // <-- Added Manage
                        'Suggest Scopes', // <-- Added Suggest (keeping it here for direct access too)
                        new inquirer.Separator(),
                        '[ Exit ]',
                    ],
                },
            ]);
            // --- END MODIFICATION ---

            // Handle specific modes that don't need further prompts here
            if (mode === '[ Exit ]') return null;
            if (mode === 'Manage Scopes') return { mode: 'Manage Scopes' };
            if (mode === 'Suggest Scopes') return { mode: 'Suggest Scopes' };

            // Model selection (Unchanged logic, only runs for relevant modes)
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

            // Conversation selection/creation/deletion (Unchanged logic)
            let conversationName: string | null = null;
            let isNewConversation = false;
            if (mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...') {
                const conversationDetails = await this.selectOrCreateConversation();
                if (mode === 'Consolidate Changes...' && conversationDetails.isNew) {
                     console.error(chalk.red("Error: Cannot consolidate new (empty) conversation.")); return null;
                }
                conversationName = conversationDetails.name;
                isNewConversation = conversationDetails.isNew;
            } else if (mode === 'Delete Conversation...') {
                const nameToDelete = await this.selectConversationToDelete();
                if (!nameToDelete) { console.log(chalk.yellow("Deletion cancelled.")); return null; }
                const { confirmDelete } = await inquirer.prompt([
                     { type: 'confirm', name: 'confirmDelete', message: `Are you sure you want to permanently delete the conversation '${nameToDelete}'?`, default: false }
                ]);
                if (confirmDelete) { conversationName = nameToDelete; } else { console.log(chalk.yellow("Deletion cancelled.")); return null; }
            }

            // Return result based on mode (Ensure conversationName exists where needed)
            if ((mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...' || mode === 'Delete Conversation...') && !conversationName) {
                 console.error(chalk.red(`Internal error: Missing conversation name for mode "${mode}".`)); return null;
            }

            if (mode === 'Start/Continue Conversation') {
                return { mode, conversationName: conversationName!, isNewConversation: isNewConversation, selectedModel: selectedModel };
            } else if (mode === 'Consolidate Changes...') {
                return { mode, conversationName: conversationName!, isNewConversation: false, selectedModel: selectedModel };
            } else if (mode === 'Delete Conversation...') {
                return { mode, conversationName: conversationName!, isNewConversation: false, selectedModel: selectedModel };
            } else {
                console.warn(chalk.yellow(`Unhandled mode selection: ${mode}`)); return null;
            }

        } catch (error) {
            if ((error as any).isTtyError) { console.error(chalk.red("Prompt unavailable in this environment.")); }
            else { console.error(chalk.red('\nError during user interaction:'), error); }
            return null;
        }
    }

    // --- NEW: handleManageScopes ---
    async handleManageScopes(): Promise<void> {
        let exitManageMenu = false;
        while (!exitManageMenu) {
            console.log(chalk.cyan("\n--- Scope Management ---"));
            try {
                const { action } = await inquirer.prompt<{ action: string }>([
                    {
                        type: 'list',
                        name: 'action',
                        message: 'Select scope action:',
                        choices: [
                            'List Scopes',
                            'Add New Scope',
                            'Modify Existing Scope',
                            'Remove Scope',
                            'Suggest Scopes', // Suggest Scopes is also part of management now
                            new inquirer.Separator(),
                            '[ Back to Main Menu ]',
                        ],
                    }
                ]);

                switch (action) {
                    case 'List Scopes':
                        await this._displayScopes();
                        break;
                    case 'Add New Scope':
                        await this._promptAddScope();
                        break;
                    case 'Modify Existing Scope':
                        await this._promptModifyScope();
                        break;
                    case 'Remove Scope':
                        await this._promptRemoveScope();
                        break;
                    case 'Suggest Scopes':
                        await this.handleSuggestScopes(); // Call existing handler
                        break;
                    case '[ Back to Main Menu ]':
                        exitManageMenu = true;
                        break;
                }
            } catch (error) {
                console.error(chalk.red('\nError during scope management:'), error);
                // Optionally add a pause here before looping back
                await inquirer.prompt([{ name: 'pause', message: 'Press Enter to continue...', type: 'input'}]);
            }
        }
        console.log(chalk.cyan("----------------------\n"));
    }

    // --- NEW: Private Scope Management Helpers ---

    private async _displayScopes(): Promise<void> {
        const scopes = await this.scopeManager.loadScopes();
        console.log(chalk.cyan("\n--- Defined Scopes ---"));
        if (scopes.length === 0) {
            console.log("No scopes defined yet in", chalk.yellow(this.config.project.scopes_file_path || '.kai/scopes.yaml'));
            console.log(chalk.dim("(The tool defaults to using all non-ignored files when no scopes are defined)"));
        } else {
            scopes.forEach(scope => {
                console.log(`- ${chalk.bold(scope.name)}: ${scope.description || chalk.gray('(No description)')}`);
                if (scope.tags && scope.tags.length > 0) {
                     console.log(`  Tags: ${chalk.magenta(scope.tags.join(', '))}`);
                }
                console.log(`  Includes (${scope.include_patterns.length}): ${chalk.green(scope.include_patterns.join(', '))}`);
                if (scope.exclude_patterns && scope.exclude_patterns.length > 0) {
                     console.log(`  Excludes (${scope.exclude_patterns.length}): ${chalk.red(scope.exclude_patterns.join(', '))}`);
                }
            });
        }
        console.log("--------------------\n");
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
    }

    private async _promptAddScope(): Promise<void> {
        console.log(chalk.cyan("\n--- Add New Scope ---"));
        const existingScopes = await this.scopeManager.loadScopes();

        try {
            const answers = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'name',
                    message: 'Scope name (unique, machine-friendly):',
                    filter: (input) => input.trim(),
                    validate: (input) => {
                        if (!input) return 'Name cannot be empty.';
                        if (existingScopes.some(s => s.name === input)) return `Scope named "${input}" already exists.`;
                        return true;
                    }
                },
                { type: 'input', name: 'description', message: 'Description (optional):' },
                {
                    type: 'editor', // Use editor for multi-line patterns
                    name: 'include_patterns_str',
                    message: 'Include patterns (one glob per line, required):',
                    validate: (text) => (text && text.trim().split('\n').some((l:string)=>l.trim())) ? true : 'At least one include pattern is required.',
                    waitUserInput: true, // Keep editor open until user saves/closes
                },
                {
                     type: 'editor',
                     name: 'exclude_patterns_str',
                     message: 'Exclude patterns (optional, one glob per line):',
                     default: '', // Start empty
                     waitUserInput: true,
                },
                { type: 'input', name: 'tags_str', message: 'Tags (optional, comma-separated):' }
            ]);

            // Process multiline/comma-separated inputs
            const include_patterns = answers.include_patterns_str.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
            const exclude_patterns = answers.exclude_patterns_str.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
            const tags = answers.tags_str.split(',').map((t:string) => t.trim()).filter((t:string) => t);

            // Re-validate includes after processing, just in case editor returns empty after trim
            if (include_patterns.length === 0) {
                console.error(chalk.red("Input validation failed: At least one valid include pattern is required after processing."));
                return;
            }

            const newScope: Scope = {
                name: answers.name,
                description: answers.description || undefined,
                include_patterns,
                exclude_patterns,
                tags,
            };

            await this.scopeManager.addScope(newScope);
            // Success message handled by scopeManager.addScope

        } catch (error) {
            console.error(chalk.red(`\nError adding scope: ${error instanceof Error ? error.message : error}`));
        }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
    }

    private async _promptModifyScope(): Promise<void> {
        console.log(chalk.cyan("\n--- Modify Existing Scope ---"));
        const scopes = await this.scopeManager.loadScopes();
        if (scopes.length === 0) {
            console.log("No scopes defined yet to modify.");
            await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]);
            return;
        }

        const { scopeNameToModify } = await inquirer.prompt([
            { type: 'list', name: 'scopeNameToModify', message: 'Select scope to modify:', choices: [...scopes.map(s => s.name), new inquirer.Separator(), '[ Cancel ]'] }
        ]);

        if (scopeNameToModify === '[ Cancel ]') return;

        const originalScope = scopes.find(s => s.name === scopeNameToModify);
        if (!originalScope) {
            console.error(chalk.red(`Error: Could not find scope "${scopeNameToModify}".`));
            return; // Should not happen if selected from list
        }

        // Create a mutable copy to potentially update
        let updatedScopeData = { ...originalScope };
        let fieldModified = false;

        const { fieldToModify } = await inquirer.prompt([
            { type: 'list', name: 'fieldToModify', message: `Modify which field of "${scopeNameToModify}"?`, choices: ['name', 'description', 'include_patterns', 'exclude_patterns', 'tags', '[ Cancel ]'] }
        ]);

        if (fieldToModify === '[ Cancel ]') return;

        try {
            switch (fieldToModify) {
                case 'name':
                    const { newName } = await inquirer.prompt([{
                        type: 'input', name: 'newName', message: 'New scope name:', default: updatedScopeData.name, filter: i => i.trim(),
                        validate: (input) => {
                            if (!input) return 'Name cannot be empty.';
                            if (input !== originalScope.name && scopes.some(s => s.name === input)) return `Scope named "${input}" already exists.`;
                            return true;
                        }
                    }]);
                    if (newName !== updatedScopeData.name) { updatedScopeData.name = newName; fieldModified = true; }
                    break;
                case 'description':
                    const { newDesc } = await inquirer.prompt([{ type: 'input', name: 'newDesc', message: 'New description:', default: updatedScopeData.description || '' }]);
                    if (newDesc !== (updatedScopeData.description || '')) { updatedScopeData.description = newDesc || undefined; fieldModified = true; }
                    break;
                case 'include_patterns':
                    const { newIncludesStr } = await inquirer.prompt([{
                         type: 'editor', name: 'newIncludesStr', message: 'Edit include patterns:', default: updatedScopeData.include_patterns.join('\n'),
                         validate: t => (t && t.trim().split('\n').some((l:string)=>l.trim())) ? true : 'Requires at least one pattern.', waitUserInput: true
                    }]);
                    const newIncludes = newIncludesStr.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
                    if (JSON.stringify(newIncludes) !== JSON.stringify(updatedScopeData.include_patterns)) { updatedScopeData.include_patterns = newIncludes; fieldModified = true; }
                    break;
                case 'exclude_patterns':
                    const { newExcludesStr } = await inquirer.prompt([{ type: 'editor', name: 'newExcludesStr', message: 'Edit exclude patterns:', default: (updatedScopeData.exclude_patterns || []).join('\n'), waitUserInput: true }]);
                    const newExcludes = newExcludesStr.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
                    if (JSON.stringify(newExcludes) !== JSON.stringify(updatedScopeData.exclude_patterns || [])) { updatedScopeData.exclude_patterns = newExcludes; fieldModified = true; }
                    break;
                case 'tags':
                    const { newTagsStr } = await inquirer.prompt([{ type: 'input', name: 'newTagsStr', message: 'New tags (comma-separated):', default: (updatedScopeData.tags || []).join(', ') }]);
                    const newTags = newTagsStr.split(',').map((t:string) => t.trim()).filter((t:string) => t);
                    if (JSON.stringify(newTags) !== JSON.stringify(updatedScopeData.tags || [])) { updatedScopeData.tags = newTags; fieldModified = true; }
                    break;
            }

            if (fieldModified) {
                // Call updateScope with the original name and the potentially modified data
                await this.scopeManager.updateScope(originalScope.name, updatedScopeData);
                 // Success message handled by scopeManager.updateScope
            } else {
                console.log(chalk.yellow("No changes made."));
            }

        } catch (error) {
            console.error(chalk.red(`\nError modifying scope: ${error instanceof Error ? error.message : error}`));
        }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
    }

    private async _promptRemoveScope(): Promise<void> {
        console.log(chalk.cyan("\n--- Remove Scope ---"));
        const scopes = await this.scopeManager.loadScopes();
        if (scopes.length === 0) {
            console.log("No scopes defined yet to remove.");
            await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]);
            return;
        }

        const { scopeNameToRemove } = await inquirer.prompt([
            { type: 'list', name: 'scopeNameToRemove', message: 'Select scope to remove:', choices: [...scopes.map(s => s.name), new inquirer.Separator(), '[ Cancel ]'] }
        ]);

        if (scopeNameToRemove === '[ Cancel ]') return;

        const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Are you sure you want to delete scope "${scopeNameToRemove}"?`, default: false }]);

        if (confirm) {
            try {
                await this.scopeManager.removeScope(scopeNameToRemove);
                 // Success message handled by scopeManager.removeScope
            } catch (error) {
                console.error(chalk.red(`\nError removing scope: ${error instanceof Error ? error.message : error}`));
            }
        } else {
            console.log(chalk.yellow("Deletion cancelled."));
        }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
    }

    // --- handleSuggestScopes (Unchanged - called by handleManageScopes) ---
    async handleSuggestScopes(): Promise<void> {
        console.log(chalk.cyan("\n🔎 Suggesting Scopes based on Project Structure..."));
        try {
            const projectFiles = await this.fs.getProjectFiles(this.projectRoot);
            if (projectFiles.length === 0) { console.log(chalk.yellow("No relevant files found.")); await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]); return; }
            console.log(chalk.dim(`   Found ${projectFiles.length} potential files...`));
            const suggestedScopes: SuggestedScope[] = [];
            suggestedScopes.push({ name: 'all_project_files', description: 'All relevant project files (respecting ignores)', include_patterns: ['**/*'], tags: ['suggestion', 'baseline', 'all'] });
            const commonSrcDirs = ['src', 'lib', 'app', 'source', 'sources'];
            let workbenchFound = false;
            for (const dirName of commonSrcDirs) { /* ... heuristic logic ... */
                 const potentialDirPath = path.join(this.projectRoot, dirName);
                 try { const stats = await fs.stat(potentialDirPath); if (stats.isDirectory()) { const wbPattern = path.posix.join(dirName, '**/*'); suggestedScopes.push({ name: 'workbench', description: `Primary source code (under ${dirName}/)`, include_patterns: [wbPattern], tags: ['suggestion', 'baseline', 'source', 'workbench'] }); workbenchFound = true; break; } } catch (e: any) { if (e.code !== 'ENOENT') console.warn(chalk.yellow(`   Warn check '${dirName}': ${e.message}`));}
            }
            const filesByDir: Map<string, string[]> = new Map();
            for (const filePath of projectFiles) { /* ... group by dir logic ... */
                 const relativePath = path.relative(this.projectRoot, filePath); const dir = path.dirname(relativePath).split(path.sep).join(path.posix.sep); const dirKey = dir === '.' ? '' : dir; if (!filesByDir.has(dirKey)) filesByDir.set(dirKey, []); filesByDir.get(dirKey)?.push(relativePath);
            }
            for (const [dir, files] of filesByDir.entries()) { /* ... generate dir scopes logic ... */
                 let scopeName = dir.replace(/^[\\\/]+|[\\\/]+$/g, '').replace(/[\\\/]+/g, '_'); if (scopeName === '') scopeName = 'root_files'; scopeName = toSnakeCase(scopeName); if (suggestedScopes.some(s => s.name === scopeName)) continue; const patternDir = dir === '' ? '.' : dir; const includePattern = path.posix.join(patternDir, '**/*'); suggestedScopes.push({ name: scopeName, description: `Files in '${dir || '<root>'}' (${files.length})`, include_patterns: [includePattern], tags: ['suggestion', 'directory-based'] });
            }
            suggestedScopes.sort((a, b) => a.name.localeCompare(b.name));
            console.log(chalk.green("\n--- Suggested Scopes (YAML format) ---"));
            if (suggestedScopes.length > 0) {
                // Use config path for instruction
                const scopesFilePath = this.config.project.scopes_file_path || '.kai/scopes.yaml';
                const outputYaml = yaml.dump({ scopes: suggestedScopes }, { indent: 2, lineWidth: -1 });
                console.log(outputYaml);
                console.log(chalk.cyan("Copy/paste these into"), chalk.yellow(scopesFilePath), chalk.cyan("or use 'Add New Scope'."));
            } else { console.log(chalk.yellow("Could not generate suggestions.")); }
            console.log("-------------------------------------\n");
        } catch (error) { console.error(chalk.red("Error suggesting scopes:"), error); }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
    }
}

export { UserInterface, UserInteractionResult, InteractionResult }; // Export the union type