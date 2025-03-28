// src/lib/ui/ScopeUIManager.ts
import inquirer from 'inquirer';
import yaml from 'js-yaml';
import path from 'path';
import fs from 'fs/promises'; // Use fs.promises for async operations
import chalk from 'chalk';
import { ScopeManager, Scope } from '../ScopeManager'; // Assuming ScopeManager is in ../ScopeManager
import { Config } from '../Config'; // Assuming Config is in ../Config
import { FileSystem } from '../FileSystem'; // Assuming FileSystem is in ../FileSystem
import { toSnakeCase } from '../utils'; // Assuming utils is in ../utils

// Type for suggested scopes (can reuse Scope if suitable)
interface SuggestedScope extends Scope {}

export class ScopeUIManager {
    private scopeManager: ScopeManager;
    private config: Config;
    private fs: FileSystem;
    private projectRoot: string;

    constructor(scopeManager: ScopeManager, config: Config, fileSystem: FileSystem, projectRoot: string) {
        this.scopeManager = scopeManager;
        this.config = config;
        this.fs = fileSystem;
        this.projectRoot = projectRoot;
    }

    /**
     * Main entry point for the interactive scope management menu.
     */
    async runManageScopes(): Promise<void> {
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
                        await this.displayScopes();
                        break;
                    case 'Add New Scope':
                        await this.promptAddScope();
                        break;
                    case 'Modify Existing Scope':
                        await this.promptModifyScope();
                        break;
                    case 'Remove Scope':
                        await this.promptRemoveScope();
                        break;
                    case 'Suggest Scopes':
                        await this.runSuggestScopes(); // Call existing handler
                        break;
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

    /**
     * Displays the currently defined scopes.
     */
    async displayScopes(): Promise<void> {
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

    /**
     * Prompts the user for details to add a new scope.
     */
    async promptAddScope(): Promise<void> {
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
                    type: 'editor',
                    name: 'include_patterns_str',
                    message: 'Include patterns (one glob per line, required):',
                    validate: (text) => (text && text.trim().split('\n').some((l:string)=>l.trim())) ? true : 'At least one include pattern is required.',
                    waitUserInput: true,
                },
                {
                     type: 'editor',
                     name: 'exclude_patterns_str',
                     message: 'Exclude patterns (optional, one glob per line):',
                     default: '',
                     waitUserInput: true,
                },
                { type: 'input', name: 'tags_str', message: 'Tags (optional, comma-separated):' }
            ]);

            const include_patterns = answers.include_patterns_str.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
            const exclude_patterns = answers.exclude_patterns_str.split('\n').map((p:string) => p.trim()).filter((p:string) => p);
            const tags = answers.tags_str.split(',').map((t:string) => t.trim()).filter((t:string) => t);

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

        } catch (error) {
            console.error(chalk.red(`\nError adding scope: ${error instanceof Error ? error.message : error}`));
        }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
    }

    /**
     * Prompts the user to select a scope and modify its fields.
     */
    async promptModifyScope(): Promise<void> {
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
            return;
        }

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
                await this.scopeManager.updateScope(originalScope.name, updatedScopeData);
            } else {
                console.log(chalk.yellow("No changes made."));
            }

        } catch (error) {
            console.error(chalk.red(`\nError modifying scope: ${error instanceof Error ? error.message : error}`));
        }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
    }

    /**
     * Prompts the user to select and confirm removal of a scope.
     */
    async promptRemoveScope(): Promise<void> {
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
            } catch (error) {
                console.error(chalk.red(`\nError removing scope: ${error instanceof Error ? error.message : error}`));
            }
        } else {
            console.log(chalk.yellow("Deletion cancelled."));
        }
        await inquirer.prompt([{ name: 'pause', message: 'Press Enter to return...', type: 'input'}]);
    }

    /**
     * Generates and displays suggested scopes based on project structure.
     */
    async runSuggestScopes(): Promise<void> {
        console.log(chalk.cyan("\n🔎 Suggesting Scopes based on Project Structure..."));
        try {
            const projectFiles = await this.fs.getProjectFiles(this.projectRoot);
            if (projectFiles.length === 0) { console.log(chalk.yellow("No relevant files found.")); await inquirer.prompt([{ name: 'pause', message: 'Press Enter...', type: 'input'}]); return; }
            console.log(chalk.dim(`   Found ${projectFiles.length} potential files...`));
            const suggestedScopes: SuggestedScope[] = [];
            // --- Suggestion Heuristics (Keep simplified or refine as needed) ---
            suggestedScopes.push({ name: 'all_project_files', description: 'All relevant project files (respecting ignores)', include_patterns: ['**/*'], tags: ['suggestion', 'baseline', 'all'] });
            const commonSrcDirs = ['src', 'lib', 'app', 'source', 'sources'];
            let workbenchFound = false;
            for (const dirName of commonSrcDirs) {
                 const potentialDirPath = path.join(this.projectRoot, dirName);
                 try { const stats = await fs.stat(potentialDirPath); if (stats.isDirectory()) { const wbPattern = path.posix.join(dirName, '**/*'); suggestedScopes.push({ name: 'workbench', description: `Primary source code (under ${dirName}/)`, include_patterns: [wbPattern], tags: ['suggestion', 'baseline', 'source', 'workbench'] }); workbenchFound = true; break; } } catch (e: any) { if (e.code !== 'ENOENT') console.warn(chalk.yellow(`   Warn check '${dirName}': ${e.message}`));}
            }
            const filesByDir: Map<string, string[]> = new Map();
            for (const filePath of projectFiles) {
                 const relativePath = path.relative(this.projectRoot, filePath); const dir = path.dirname(relativePath).split(path.sep).join(path.posix.sep); const dirKey = dir === '.' ? '' : dir; if (!filesByDir.has(dirKey)) filesByDir.set(dirKey, []); filesByDir.get(dirKey)?.push(relativePath);
            }
            for (const [dir, files] of filesByDir.entries()) {
                 let scopeName = dir.replace(/^[\\\/]+|[\\\/]+$/g, '').replace(/[\\\/]+/g, '_'); if (scopeName === '') scopeName = 'root_files'; scopeName = toSnakeCase(scopeName); if (suggestedScopes.some(s => s.name === scopeName)) continue; const patternDir = dir === '' ? '.' : dir; const includePattern = path.posix.join(patternDir, '**/*'); suggestedScopes.push({ name: scopeName, description: `Files in '${dir || '<root>'}' (${files.length})`, include_patterns: [includePattern], tags: ['suggestion', 'directory-based'] });
            }
            // --- End Heuristics ---

            suggestedScopes.sort((a, b) => a.name.localeCompare(b.name));
            console.log(chalk.green("\n--- Suggested Scopes (YAML format) ---"));
            if (suggestedScopes.length > 0) {
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