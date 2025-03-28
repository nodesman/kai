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
// --- Import Extracted UI Classes (keep for context, but only SublimeEditorInteraction used directly) ---
// import { ScopeUIManager } from './ui/ScopeUIManager'; // Removed as management logic is back here, suggestion uses AIClient
import { SublimeEditorInteraction, EditorInteractionResult } from './ui/SublimeEditorInteraction';
// --- End Import Extracted UI Classes ---
// --- Keep ScopeManager import for instantiation and validation ---
import { ScopeManager, Scope } from './ScopeManager';
// --- End Keep ScopeManager import ---
// --- ADD AIClient Import ---
import { AIClient } from './AIClient';
// --- END ADD AIClient Import ---

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
interface SuggestedScope extends Scope {} // Keep this interface definition here

class UserInterface {
    fs: FileSystem;
    config: Config;
    projectRoot: string;
    scopeManager: ScopeManager; // Keep for dependency injection and validation
    // --- ADD AIClient instance ---
    aiClient: AIClient;
    // --- END ADD AIClient instance ---
    // --- Instantiate Extracted UI Handlers (SublimeEditorInteraction needed for getPromptViaSublimeLoop) ---
    // private scopeUIManager: ScopeUIManager; // Removed - logic now in this class
    private sublimeEditorInteraction: SublimeEditorInteraction;
    // --- End Instantiate Extracted UI Handlers ---

    constructor(config: Config) { // Accept config
        this.fs = new FileSystem();
        this.config = config;
        this.projectRoot = process.cwd();
        // --- Instantiate Managers ---
        this.scopeManager = new ScopeManager(config, this.fs);
        // --- ADD AIClient Instantiation ---
        this.aiClient = new AIClient(config);
        // --- END AIClient Instantiation ---
        // this.scopeUIManager = new ScopeUIManager(this.scopeManager, config, this.fs, this.projectRoot); // Removed
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
        return selected;
    }

    // --- getPromptViaSublimeLoop (Unchanged - relies on SublimeEditorInteraction) ---
    async getPromptViaSublimeLoop(
        conversationName: string,
        currentMessages: Message[],
        editorFilePath: string // Keep signature, SublimeEditorInteraction ignores it
    ): Promise<{ newPrompt: string | null; conversationFilePath: string; editorFilePath: string }> {
        const snakeName = toSnakeCase(conversationName);
        const conversationFileName = `${snakeName}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);

        // Delegate to SublimeEditorInteraction
        const editorResult: EditorInteractionResult = await this.sublimeEditorInteraction.getPrompt(
            conversationName,
            currentMessages
        );

        // Reconstruct the object CodeProcessor expects.
        const editorFileName = `${toSnakeCase(conversationName)}_edit.txt`;
        const determinedEditorFilePath = path.join(this.config.chatsDir, editorFileName);


        return {
            newPrompt: editorResult.newPrompt,
            conversationFilePath: conversationFilePath,
            editorFilePath: determinedEditorFilePath // Return the path SublimeEditorInteraction used
        };
    }


    // --- getUserInteraction (MODIFIED - Calls internal methods for scopes) ---
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

            if (mode === '[ Exit ]') return null;

            // --- HANDLE Scope Actions Directly in this Class ---
            if (mode === 'Manage Scopes') {
                // Call the internal method now
                await this.handleManageScopes();
                return { mode: 'Manage Scopes' }; // Signal handled
            }
            if (mode === 'Suggest Scopes') {
                // Call the internal method now
                await this.handleSuggestScopes();
                return { mode: 'Suggest Scopes' }; // Signal handled
            }
            // --- END Scope Handling ---

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
                const conversationDetails = await this.selectOrCreateConversation();
                if (mode === 'Consolidate Changes...' && conversationDetails.isNew) {
                     console.error(chalk.red("Error: Cannot consolidate new (empty) conversation. Please start the conversation first."));
                     return null;
                }
                conversationName = conversationDetails.name;
                isNewConversation = conversationDetails.isNew;
            } else if (mode === 'Delete Conversation...') {
                const nameToDelete = await this.selectConversationToDelete();
                if (!nameToDelete) { console.log(chalk.yellow("Deletion cancelled.")); return null; }
                const { confirmDelete } = await inquirer.prompt([
                     { type: 'confirm', name: 'confirmDelete', message: `Are you sure you want to permanently delete the conversation '${nameToDelete}'?`, default: false }
                ]);
                if (confirmDelete) {
                     conversationName = nameToDelete;
                } else {
                     console.log(chalk.yellow("Deletion cancelled.")); return null;
                }
            }

            if ((mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...' || mode === 'Delete Conversation...') && !conversationName) {
                 console.error(chalk.red(`Internal error: Missing conversation name for mode "${mode}". Interaction cancelled.`));
                 return null;
            }

            if (mode === 'Start/Continue Conversation') {
                return { mode, conversationName: conversationName!, isNewConversation: isNewConversation, selectedModel: selectedModel };
            } else if (mode === 'Consolidate Changes...') {
                return { mode, conversationName: conversationName!, isNewConversation: false, selectedModel: selectedModel };
            } else if (mode === 'Delete Conversation...') {
                return { mode, conversationName: conversationName!, isNewConversation: false, selectedModel: selectedModel };
            } else {
                console.warn(chalk.yellow(`Unhandled mode selection reached end: ${mode}`)); return null;
            }

        } catch (error) {
            if ((error as any).isTtyError) { console.error(chalk.red("Prompt unavailable in this environment.")); }
            else { console.error(chalk.red('\nError during user interaction:'), error); }
            return null;
        }
    }

    // --- handleManageScopes (Kept here, using private helpers) ---
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
                            // 'Suggest Scopes', // Suggestion is a separate top-level option now
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
                    // case 'Suggest Scopes': // Removed from here
                    //     await this.handleSuggestScopes(); // Call the AI version
                    //     break;
                    case '[ Back to Main Menu ]':
                        exitManageMenu = true;
                        break;
                }
            } catch (error) {
                console.error(chalk.red('\nError during scope management:'), error);
                await inquirer.prompt([{ name: 'pause', message: 'Press Enter to continue...', type: 'input'}]);
            }
        }
        console.log(chalk.cyan("----------------------\n"));
    }

    // --- _displayScopes (Private helper for handleManageScopes) ---
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

    // --- _promptAddScope (Private helper) ---
    private async _promptAddScope(): Promise<void> {
        console.log(chalk.cyan("\n--- Add New Scope ---"));
        const existingScopes = await this.scopeManager.loadScopes();
        try {
            const answers = await inquirer.prompt([
                 { type: 'input', name: 'name', message: 'Scope name (unique, machine-friendly):', filter: (i) => i.trim(),
                   validate: (input) => { if (!input) return 'Name cannot be empty.'; if (existingScopes.some(s => s.name === input)) return `Scope named "${input}" already exists.`; return true; } },
                 { type: 'input', name: 'description', message: 'Description (optional):' },
                 { type: 'editor', name: 'include_patterns_str', message: 'Include patterns (one glob per line, required):',
                   validate: (text) => (text && text.trim().split('\n').some((l:string)=>l.trim())) ? true : 'At least one include pattern is required.', waitUserInput: true },
                 { type: 'editor', name: 'exclude_patterns_str', message: 'Exclude patterns (optional, one glob per line):', default: '', waitUserInput: true },
                 { type: 'input', name: 'tags_str', message: 'Tags (optional, comma-separated):' }
            ]);
            const include_patterns = answers.include_patterns_str.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
            const exclude_patterns = answers.exclude_patterns_str.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
            const tags = answers.tags_str.split(',').map((t:string) => t.trim()).filter((t:string) => t);
            if (include_patterns.length === 0) { console.error(chalk.red("Input validation failed: At least one valid include pattern required.")); return; }
            const newScope: Scope = { name: answers.name, description: answers.description || undefined, include_patterns, exclude_patterns, tags };
            await this.scopeManager.addScope(newScope);
        } catch (error) { console.error(chalk.red(`\nError adding scope: ${error instanceof Error ? error.message : error}`)); }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]);
    }

    // --- _promptModifyScope (Private helper) ---
    private async _promptModifyScope(): Promise<void> {
        console.log(chalk.cyan("\n--- Modify Existing Scope ---"));
        const scopes = await this.scopeManager.loadScopes();
        if (scopes.length === 0) { console.log("No scopes to modify."); await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]); return; }
        const { scopeNameToModify } = await inquirer.prompt([{ type: 'list', name: 'scopeNameToModify', message: 'Select scope to modify:', choices: [...scopes.map(s => s.name), new inquirer.Separator(), '[ Cancel ]'] }]);
        if (scopeNameToModify === '[ Cancel ]') return;
        const originalScope = scopes.find(s => s.name === scopeNameToModify);
        if (!originalScope) { console.error(chalk.red(`Error: Scope "${scopeNameToModify}" not found.`)); return; }
        let updatedScopeData = { ...originalScope }; let fieldModified = false;
        const { fieldToModify } = await inquirer.prompt([{ type: 'list', name: 'fieldToModify', message: `Modify which field of "${scopeNameToModify}"?`, choices: ['name', 'description', 'include_patterns', 'exclude_patterns', 'tags', '[ Cancel ]'] }]);
        if (fieldToModify === '[ Cancel ]') return;
        try {
            switch (fieldToModify) {
                case 'name':
                    const { newName } = await inquirer.prompt([{ type: 'input', name: 'newName', message: 'New name:', default: updatedScopeData.name, filter: i => i.trim(), validate: (i) => { if (!i) return 'Name cannot be empty.'; if (i !== originalScope.name && scopes.some(s => s.name === i)) return `Scope "${i}" exists.`; return true; } }]);
                    if (newName !== updatedScopeData.name) { updatedScopeData.name = newName; fieldModified = true; } break;
                case 'description':
                    const { newDesc } = await inquirer.prompt([{ type: 'input', name: 'newDesc', message: 'New description:', default: updatedScopeData.description || '' }]);
                    if (newDesc !== (updatedScopeData.description || '')) { updatedScopeData.description = newDesc || undefined; fieldModified = true; } break;
                case 'include_patterns':
                    const { newIncludesStr } = await inquirer.prompt([{ type: 'editor', name: 'newIncludesStr', message: 'Edit includes:', default: updatedScopeData.include_patterns.join('\n'), validate: t => (t && t.trim().split('\n').some((l:string)=>l.trim())) ? true : 'Requires >= 1 pattern.', waitUserInput: true }]);
                    const newIncludes = newIncludesStr.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
                    if (JSON.stringify(newIncludes) !== JSON.stringify(updatedScopeData.include_patterns)) { updatedScopeData.include_patterns = newIncludes; fieldModified = true; } break;
                case 'exclude_patterns':
                    const { newExcludesStr } = await inquirer.prompt([{ type: 'editor', name: 'newExcludesStr', message: 'Edit excludes:', default: (updatedScopeData.exclude_patterns || []).join('\n'), waitUserInput: true }]);
                    const newExcludes = newExcludesStr.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
                    if (JSON.stringify(newExcludes) !== JSON.stringify(updatedScopeData.exclude_patterns || [])) { updatedScopeData.exclude_patterns = newExcludes; fieldModified = true; } break;
                case 'tags':
                    const { newTagsStr } = await inquirer.prompt([{ type: 'input', name: 'newTagsStr', message: 'New tags (comma-separated):', default: (updatedScopeData.tags || []).join(', ') }]);
                    const newTags = newTagsStr.split(',').map((t:string) => t.trim()).filter((t:string) => t);
                    if (JSON.stringify(newTags) !== JSON.stringify(updatedScopeData.tags || [])) { updatedScopeData.tags = newTags; fieldModified = true; } break;
            }
            if (fieldModified) { await this.scopeManager.updateScope(originalScope.name, updatedScopeData); } else { console.log(chalk.yellow("No changes made.")); }
        } catch (error) { console.error(chalk.red(`\nError modifying scope: ${error instanceof Error ? error.message : error}`)); }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]);
    }

    // --- _promptRemoveScope (Private helper) ---
    private async _promptRemoveScope(): Promise<void> {
        console.log(chalk.cyan("\n--- Remove Scope ---"));
        const scopes = await this.scopeManager.loadScopes();
        if (scopes.length === 0) { console.log("No scopes to remove."); await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]); return; }
        const { scopeNameToRemove } = await inquirer.prompt([{ type: 'list', name: 'scopeNameToRemove', message: 'Select scope to remove:', choices: [...scopes.map(s => s.name), new inquirer.Separator(), '[ Cancel ]'] }]);
        if (scopeNameToRemove === '[ Cancel ]') return;
        const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Delete scope "${scopeNameToRemove}"?`, default: false }]);
        if (confirm) { try { await this.scopeManager.removeScope(scopeNameToRemove); } catch (error) { console.error(chalk.red(`\nError removing scope: ${error instanceof Error ? error.message : error}`)); } }
        else { console.log(chalk.yellow("Deletion cancelled.")); }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]);
    }

    // --- NEW: handleSuggestScopes (Using AI) ---
    async handleSuggestScopes(): Promise<void> {
        console.log(chalk.cyan("\n🔎 Suggesting Scopes using AI based on Project Structure..."));
        const scopesFilePath = this.config.project.scopes_file_path || '.kai/scopes.yaml';
        let shouldPause = true; // Flag to control final pause

        try {
            // 1. Get all relevant project files (respecting .gitignore etc.)
            console.log(chalk.dim("   Analyzing project file structure..."));
            const absoluteFilePaths = await this.fs.getProjectFiles(this.projectRoot);

            if (absoluteFilePaths.length === 0) {
                console.log(chalk.yellow("No relevant files found in the project to analyze. Cannot generate suggestions."));
                return; // Proceed to finally for pause
            }
            console.log(chalk.dim(`   Found ${absoluteFilePaths.length} project files to analyze...`));

            // 2. Convert to relative paths (POSIX style for prompt consistency)
            const relativeFilePaths = absoluteFilePaths.map(p =>
                path.relative(this.projectRoot, p).split(path.sep).join(path.posix.sep) // Use POSIX separators
            );

            // Limit file list size if it's extremely large to avoid excessive prompt length/cost
            const MAX_FILES_IN_PROMPT = 1000; // Adjust as needed
            let filesForPrompt = relativeFilePaths;
            if (relativeFilePaths.length > MAX_FILES_IN_PROMPT) {
                console.warn(chalk.yellow(`   Warning: Project has > ${MAX_FILES_IN_PROMPT} files. Sending a sample of ${MAX_FILES_IN_PROMPT} to AI for suggestions.`));
                filesForPrompt = relativeFilePaths.slice(0, MAX_FILES_IN_PROMPT);
            }

            // 3. Construct the AI Prompt for scope suggestions
            const prompt = `
Analyze the following list of project file paths and suggest logical groupings (scopes) for an AI coding assistant's context mechanism.
Each scope should represent a related set of files (e.g., by feature, layer, file type, main directory).

Input File List (${filesForPrompt.length} files sampled if > ${MAX_FILES_IN_PROMPT}):
\`\`\`
${filesForPrompt.join('\n')}
\`\`\`

Task:
Generate a YAML output containing a single root key "scopes". The value should be a list of scope objects.
Each scope object MUST have:
- name: A short, descriptive, machine-friendly name (e.g., 'backend_routes', 'ui_components', 'database_models'). Use snake_case. MUST be unique.
- description: A brief explanation of the scope's purpose (e.g., 'Core Node.js service files').
- include_patterns: A list of one or more glob patterns (using forward slashes '/') that match the files belonging to this scope. Use patterns like 'src/services/**/*.ts' or 'config/*.yaml'. Be specific but use globs effectively. Try to cover all or most input files across the suggested scopes.
- exclude_patterns (optional): A list of glob patterns to exclude files within the include patterns (e.g., '**/*.test.ts', '**/*.spec.ts').
- tags (optional): A list of relevant string tags (e.g., 'backend', 'frontend', 'test', 'config', 'documentation').

Guidelines:
- Aim for a reasonable number of useful scopes (e.g., 3-10) depending on the project size and structure. Avoid overly broad ('all_files') or overly granular scopes unless clearly warranted.
- Prioritize grouping by top-level directories (like 'src', 'tests', 'config', 'docs') or distinct features if identifiable from paths. Group common file types like configuration or documentation.
- Ensure the generated YAML is valid according to the structure described.
- Ensure glob patterns correctly use forward slashes '/'.
- Respond ONLY with the YAML content, starting exactly with "scopes:". Do not include any introductory text, explanations, comments, or markdown fences (like \`\`\`yaml or \`\`\`).

Example Output Format:
\`\`\`yaml
scopes:
  - name: backend_logic
    description: Core Node.js service files
    include_patterns:
      - "src/services/**/*.ts"
      - "src/routes/**/*.ts"
    exclude_patterns:
      - "**/*.test.ts"
    tags:
      - backend
      - node
  - name: config_files
    description: Project configuration files
    include_patterns:
      - "config/**/*.yaml"
      - "*.json"
    tags:
      - config
  - name: documentation
    description: Project documentation files
    include_patterns:
      - "docs/**/*.md"
      - "README.md"
    tags:
      - documentation
\`\`\`
            `; // End of prompt string

            // 4. Call the AI (use Flash model for speed/cost)
            console.log(chalk.blue("   Sending file list to AI for scope suggestions (using Flash model)..."));
            const aiResponseYaml = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: prompt }],
                true // Use Flash model = true
            );

            // 5. Display the result
            console.log(chalk.green("\n--- AI Suggested Scopes (YAML format) ---"));
            if (aiResponseYaml && aiResponseYaml.trim()) {
                let outputYaml = aiResponseYaml.trim();

                // Basic check if it looks like valid YAML starting point
                if (!outputYaml.startsWith('scopes:') && !outputYaml.startsWith('- name:')) {
                    console.warn(chalk.yellow("Warning: AI response might not be in the exact expected YAML format (doesn't start with 'scopes:' or '- name:'). Displaying raw response."));
                }

                // Optional: Attempt to parse and re-dump for validation/formatting
                let parsedSuccessfully = false;
                try {
                    const parsed = yaml.load(outputYaml);
                     // Check if parsing resulted in an object with a 'scopes' array or explicitly null/empty array
                     if (typeof parsed === 'object' && parsed !== null && typeof (parsed as any).scopes !== 'undefined') {
                         if (Array.isArray((parsed as any).scopes)) {
                            // Validate scopes minimally (using the private helper from ScopeManager)
                            // This requires access to the ScopeManager instance.
                            const { validScopes, invalidCount } = this.scopeManager['_validateScopesArray']((parsed as any).scopes); // Access private method using bracket notation
                            if (invalidCount > 0) {
                                 console.warn(chalk.yellow(`Warning: AI suggestion included ${invalidCount} invalid scope definition(s) according to validation rules. They might be excluded or cause issues.`));
                            }
                            // Re-dump only the valid scopes for cleaner output
                            outputYaml = yaml.dump({ scopes: validScopes }, { indent: 2, lineWidth: -1 });
                            parsedSuccessfully = true;
                            console.log(chalk.dim("(AI response YAML parsed and validated successfully)"));
                         } else if ((parsed as any).scopes === null) {
                            // Handle the case where the AI explicitly returns `scopes: null`
                            outputYaml = yaml.dump({ scopes: [] }, { indent: 2, lineWidth: -1 }); // Standardize empty list
                            parsedSuccessfully = true;
                            console.log(chalk.dim("(AI suggested an empty scope list)"));
                         } else {
                             // 'scopes' key exists but isn't an array or null
                             console.warn(chalk.yellow("Warning: AI response YAML has 'scopes' key but its value is not an array or null. Displaying raw response."));
                         }
                    } else {
                       // Parsed object is null or doesn't have a 'scopes' key at all
                       console.warn(chalk.yellow("Warning: AI response was not parsed as the expected { scopes: [...] } structure. Displaying raw response."));
                    }
                } catch (parseError) {
                    console.warn(chalk.yellow("Warning: Could not parse AI response as YAML. Displaying raw response."), parseError);
                }

                console.log(outputYaml); // Display the YAML (cleaned or raw)
                console.log(chalk.cyan("\nReview the suggestions above. Copy/paste relevant scopes into"), chalk.yellow(scopesFilePath), chalk.cyan("or use 'Add New Scope'/'Modify Existing Scope' within 'Manage Scopes' to add/refine them."));
            } else {
                console.log(chalk.yellow("AI did not provide any suggestions or the response was empty."));
            }
            console.log("------------------------------------------\n");

        } catch (error) {
            console.error(chalk.red("\nError suggesting scopes using AI:"), error);
            shouldPause = false; // Prevent double pause in finally
            await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
        } finally {
            // Make sure the pause happens if no error occurred or if error didn't trigger the pause
            if (shouldPause) {
               await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
            }
        }
    }
    // --- End NEW handleSuggestScopes ---

} // End UserInterface Class

export { UserInterface, UserInteractionResult, InteractionResult };