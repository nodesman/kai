// src/lib/ScopeManager.ts
import path from 'path';
import yaml from 'js-yaml';
import ignore from 'ignore'; // 'ignore' library is still needed for pattern matching in resolveFilesForScopes
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { Config } from './Config'; // Import Config class

// Define the structure of a single scope
export interface Scope {
    name: string;
    description?: string;
    include_patterns: string[];
    exclude_patterns?: string[];
    tags?: string[];
}

// Define the structure of the scopes file
interface ScopesFile {
    scopes: Scope[];
}

const DEFAULT_SCOPES_YAML_CONTENT = `# Define scopes for the kai tool here.
# Each scope is a set of files identified by glob patterns, used to limit
# the context sent to the AI. If this list is empty, kai defaults to
# including ALL non-ignored project files (like .gitignore).
#
# Run 'kai' and select 'Suggest Scopes' to get suggestions based on your project.
# Run 'kai' and select 'Manage Scopes' to add/edit/remove scopes interactively.
#
# Example Scope:
# - name: backend_logic
#   description: Core Node.js service files
#   include_patterns:
#     - "src/services/**/*.ts"
#     - "src/routes/**/*.ts"
#   exclude_patterns:
#     - "**/*.test.ts"
#   tags:
#     - backend
#     - node

scopes: [] # Start with an empty list. The tool defaults to 'all files' when this is empty.
`;

export class ScopeManager {
    private config: Config;
    private fs: FileSystem;
    private scopesFilePath: string; // Absolute path

    constructor(config: Config, fileSystem: FileSystem) {
        this.config = config;
        this.fs = fileSystem;
        // Resolve the absolute path based on CWD and the configured relative path
        // Use config.project.scopes_file_path which should exist based on Config.ts structure
        // Provide a fallback just in case the property access somehow fails, though it shouldn't with Required<>
        const relativePath = config.project?.scopes_file_path || '.kai/scopes.yaml';
        this.scopesFilePath = path.resolve(process.cwd(), relativePath);
        console.log(chalk.dim(`ScopeManager initialized. Scopes file path: ${this.scopesFilePath}`));
    }

    /**
     * Ensures the scopes file exists, creating a default one if necessary.
     * Does NOT load the scopes, just ensures the file is present.
     * @returns {Promise<boolean>} True if the file existed or was created, false on error.
     */
    private async ensureScopeFileExists(): Promise<boolean> {
        try {
            await this.fs.access(this.scopesFilePath);
            // console.log(chalk.dim(`Scope file found at: ${this.scopesFilePath}`)); // Optional logging
            return true; // File exists
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, try to create it
                console.log(chalk.blue(`Scopes file not found at: ${this.scopesFilePath}. Creating default file...`));
                try {
                    const dirPath = path.dirname(this.scopesFilePath);
                    await this.fs.ensureDirExists(dirPath); // Ensure parent directory exists
                    await this.fs.writeFile(this.scopesFilePath, DEFAULT_SCOPES_YAML_CONTENT);
                    console.log(chalk.green(`Successfully created default scopes file: ${this.scopesFilePath}`));
                    return true; // File created
                } catch (createError) {
                    console.error(chalk.red(`Error creating default scopes file ${this.scopesFilePath}:`), createError);
                    return false; // Failed to create
                }
            } else {
                // Other access error (permissions?)
                console.error(chalk.red(`Error accessing scopes file ${this.scopesFilePath}:`), error);
                return false; // Failed to access
            }
        }
    }


    /**
     * Loads scope definitions from the configured YAML file.
     * Handles file not found (creates default), empty file, and parsing errors gracefully.
     * @returns {Promise<Scope[]>} A promise resolving to an array of loaded Scope objects. Returns [] if file cannot be read/parsed or is empty/default.
     */
    async loadScopes(): Promise<Scope[]> {
        const fileExists = await this.ensureScopeFileExists();
        if (!fileExists) {
            console.error(chalk.red(`Failed to ensure existence of scope file at ${this.scopesFilePath}. Proceeding without scopes.`));
            return []; // Cannot proceed if file access/creation failed
        }

        try {
            const fileContent = await this.fs.readFile(this.scopesFilePath);
            if (fileContent === null) {
                 // This case should be less likely now due to ensureScopeFileExists, but handle defensively
                 console.log(chalk.yellow(`Could not read scope file content at ${this.scopesFilePath} after ensuring existence. Proceeding without scopes.`));
                 return [];
            }
            if (fileContent.trim() === '' || fileContent === DEFAULT_SCOPES_YAML_CONTENT) {
                // Treat newly created default file, empty file, or unmodified default as having no *user-defined* scopes
                 if (fileContent === DEFAULT_SCOPES_YAML_CONTENT) {
                     console.log(chalk.dim(`Scopes file contains default template. No user-defined scopes loaded.`));
                 } else {
                    console.log(chalk.blue(`Scopes file is empty at: ${this.scopesFilePath}. No user-defined scopes loaded.`));
                 }
                return [];
            }

            const loadedData = yaml.load(fileContent) as ScopesFile | null | undefined;

            if (!loadedData || typeof loadedData !== 'object' || !Array.isArray(loadedData.scopes)) {
                console.warn(chalk.yellow(`Warning: Invalid format in ${this.scopesFilePath}. Expected root object with a 'scopes: [...]' array. No scopes loaded.`));
                return [];
            }

            // --- Validation Logic (moved to helper for reuse) ---
            const { validScopes, invalidCount } = this._validateScopesArray(loadedData.scopes);
            // --- End Validation Logic ---

            if (invalidCount > 0) {
                console.warn(chalk.yellow(`Warning: Ignored ${invalidCount} invalid scope definitions from ${this.scopesFilePath}.`));
            }

            // Only log success if actual scopes were loaded
            if (validScopes.length > 0) {
                console.log(chalk.blue(`Loaded ${validScopes.length} valid scopes from ${this.scopesFilePath}`));
            } else if (invalidCount === 0) {
                // File had `scopes: []`, which is valid but means no scopes loaded
                console.log(chalk.blue(`Scopes file defines an empty list. No user-defined scopes loaded.`));
            }
            return validScopes;

        } catch (error: any) {
             // Handle errors other than initial ENOENT (e.g., permissions during read, YAML parse error)
             console.error(chalk.red(`Error loading or parsing scopes file ${this.scopesFilePath}:`), error);
             return []; // Return empty array on error
        }
    }

    /**
     * Validates an array of raw scope objects.
     * @param scopesData - The raw array from the YAML file.
     * @returns An object containing the valid scopes and the count of invalid ones.
     */
    private _validateScopesArray(scopesData: any[]): { validScopes: Scope[], invalidCount: number } {
        const validScopes: Scope[] = [];
        let invalidCount = 0;
        if (!scopesData) return { validScopes, invalidCount }; // Should not happen if called after initial check, but safe

        for (const scope of scopesData) {
            if (scope && typeof scope.name === 'string' && scope.name.trim() && Array.isArray(scope.include_patterns)) {
                 // Normalize patterns: ensure they are strings and trim whitespace
                 const include_patterns = scope.include_patterns
                    .filter((p: any) => typeof p === 'string')
                    .map((p: string) => p.trim())
                    .filter((p: string) => p.length > 0);

                 let exclude_patterns: string[] = [];
                 if (scope.exclude_patterns && Array.isArray(scope.exclude_patterns)) {
                     exclude_patterns = scope.exclude_patterns
                         .filter((p: any) => typeof p === 'string')
                         .map((p: string) => p.trim())
                         .filter((p: string) => p.length > 0);
                 }

                 let tags: string[] = [];
                 if (scope.tags && Array.isArray(scope.tags)) {
                    tags = scope.tags
                        .filter((t: any) => typeof t === 'string')
                        .map((t: string) => t.trim())
                        .filter((t: string) => t.length > 0);
                 }

                 if(include_patterns.length > 0) {
                     // Construct a validated scope object
                     validScopes.push({
                         name: scope.name.trim(),
                         description: typeof scope.description === 'string' ? scope.description.trim() : undefined,
                         include_patterns,
                         exclude_patterns,
                         tags
                     });
                 } else {
                     console.warn(chalk.yellow(`Warning: Scope "${scope.name}" in ${this.scopesFilePath} has no valid include_patterns. Ignoring.`));
                     invalidCount++;
                 }
            } else {
                 console.warn(chalk.yellow(`Warning: Invalid scope definition found in ${this.scopesFilePath} (missing name or include_patterns). Ignoring:`), JSON.stringify(scope));
                 invalidCount++;
            }
        }
        return { validScopes, invalidCount };
    }

    /**
     * Saves the provided array of scopes to the scopes file, overwriting existing content.
     * @param {Scope[]} scopes - The array of scope objects to save.
     * @throws {Error} If saving fails.
     */
    async saveScopes(scopes: Scope[]): Promise<void> {
        // Sort scopes alphabetically by name before saving for consistency
        scopes.sort((a, b) => a.name.localeCompare(b.name));

        console.log(chalk.dim(`Attempting to save ${scopes.length} scopes to ${this.scopesFilePath}...`));
        try {
            const dataToSave = { scopes: scopes };
            // lineWidth: -1 prevents automatic line wrapping from js-yaml
            const yamlString = yaml.dump(dataToSave, { indent: 2, lineWidth: -1 });
            await this.fs.writeFile(this.scopesFilePath, yamlString);
            console.log(chalk.green(`Successfully saved ${scopes.length} scopes to ${this.scopesFilePath}.`));
        } catch (error) {
            console.error(chalk.red(`Error saving scopes file ${this.scopesFilePath}:`), error);
            throw new Error(`Failed to save scopes file: ${(error as Error).message}`); // Re-throw for UI feedback
        }
    }

    /**
     * Adds a new scope definition to the scopes file.
     * @param {Scope} newScope - The scope object to add.
     * @throws {Error} If a scope with the same name already exists or saving fails.
     */
    async addScope(newScope: Scope): Promise<void> {
        // Basic validation on the input scope
        if (!newScope || !newScope.name?.trim() || !Array.isArray(newScope.include_patterns) || newScope.include_patterns.length === 0 || newScope.include_patterns.some(p => !p.trim())) {
             throw new Error("Invalid scope data provided: Requires at least a non-empty name and one non-empty include pattern.");
        }

        const currentScopes = await this.loadScopes(); // Load existing scopes

        // Check for name conflict
        if (currentScopes.some(s => s.name === newScope.name.trim())) {
            throw new Error(`Scope named "${newScope.name.trim()}" already exists.`);
        }

        // Add the validated new scope
        currentScopes.push({
             name: newScope.name.trim(),
             description: newScope.description?.trim() || undefined,
             include_patterns: newScope.include_patterns.map(p=>p.trim()).filter(p=>p.length>0),
             exclude_patterns: (newScope.exclude_patterns || []).map(p=>p.trim()).filter(p=>p.length>0),
             tags: (newScope.tags || []).map(t=>t.trim()).filter(t=>t.length>0)
        });

        await this.saveScopes(currentScopes); // Save the updated list
        console.log(chalk.green(`Scope "${newScope.name.trim()}" added successfully.`));
    }

     /**
      * Updates an existing scope definition or changes its name.
      * @param {string} originalName - The current name of the scope to update.
      * @param {Scope} updatedScopeData - The new data for the scope (can include a changed name).
      * @throws {Error} If the original scope is not found, the new name conflicts, or saving fails.
      */
     async updateScope(originalName: string, updatedScopeData: Scope): Promise<void> {
         // Basic validation on the updated scope data
         if (!updatedScopeData || !updatedScopeData.name?.trim() || !Array.isArray(updatedScopeData.include_patterns) || updatedScopeData.include_patterns.length === 0 || updatedScopeData.include_patterns.some(p => !p.trim())) {
              throw new Error("Invalid updated scope data provided: Requires at least a non-empty name and one non-empty include pattern.");
         }

         const currentScopes = await this.loadScopes();
         const index = currentScopes.findIndex(s => s.name === originalName);

         if (index === -1) {
             throw new Error(`Scope "${originalName}" not found.`);
         }

         // Check for name conflict ONLY if the name is changing
         const newName = updatedScopeData.name.trim();
         if (originalName !== newName) {
             if (currentScopes.some((s, i) => i !== index && s.name === newName)) {
                 throw new Error(`Cannot rename scope: A scope named "${newName}" already exists.`);
             }
         }

         // Replace the scope data at the found index with validated data
         currentScopes[index] = {
             name: newName,
             description: updatedScopeData.description?.trim() || undefined,
             include_patterns: updatedScopeData.include_patterns.map(p=>p.trim()).filter(p=>p.length>0),
             exclude_patterns: (updatedScopeData.exclude_patterns || []).map(p=>p.trim()).filter(p=>p.length>0),
             tags: (updatedScopeData.tags || []).map(t=>t.trim()).filter(t=>t.length>0)
         };

         await this.saveScopes(currentScopes);
         console.log(chalk.green(`Scope "${originalName}" updated successfully ${originalName !== newName ? `(renamed to "${newName}")` : ''}.`));
     }

    /**
     * Removes a scope definition from the scopes file.
     * @param {string} scopeName - The name of the scope to remove.
     * @throws {Error} If the scope is not found or saving fails.
     */
    async removeScope(scopeName: string): Promise<void> {
        const currentScopes = await this.loadScopes();
        const initialLength = currentScopes.length;
        const updatedScopes = currentScopes.filter(s => s.name !== scopeName);

        if (updatedScopes.length === initialLength) {
            throw new Error(`Scope named "${scopeName}" not found.`);
        }

        await this.saveScopes(updatedScopes);
        console.log(chalk.green(`Scope "${scopeName}" removed successfully.`));
    }


    /**
     * Resolves the list of absolute file paths that match the combined patterns of the provided scopes.
     * If no scopes are provided (e.g., file not found or empty), it defaults to returning all project files respecting .gitignore.
     * @param {Scope[]} scopes - An array of Scope objects loaded by loadScopes().
     * @param {string} projectRoot - The absolute path to the project root.
     * @returns {Promise<string[]>} A promise resolving to an array of absolute file paths matching the scopes or all files if no scopes given.
     */
    async resolveFilesForScopes(scopes: Scope[], projectRoot: string): Promise<string[]> {
        // --- Default Behavior (No user-defined scopes loaded) ---
        if (scopes.length === 0) {
            console.log(chalk.blue("No user-defined scopes loaded or active. Defaulting to including all project files (respecting .gitignore)."));
            // fs.getProjectFiles should handle .gitignore and internal defaults like .kaichats
            return await this.fs.getProjectFiles(projectRoot);
        }
        // --- End Default Behavior ---

        console.log(chalk.blue(`Resolving files based on ${scopes.length} loaded scope(s)...`));

        // 1. Combine include/exclude patterns from all provided scopes
        const allIncludes = scopes.flatMap(s => s.include_patterns);
        const allExcludes = scopes.flatMap(s => s.exclude_patterns || []);

        // Redundant check due to validation in loadScopes, but safe
        if (allIncludes.length === 0) {
            console.warn(chalk.yellow("Warning: Loaded scopes collectively have no valid 'include_patterns'. No files will be selected."));
            return [];
        }

        // 2. Get all potentially relevant files (respecting .gitignore primarily)
        const initialFiles = await this.fs.getProjectFiles(projectRoot);
        if (initialFiles.length === 0) {
            console.log(chalk.yellow("No project files found after initial .gitignore filtering. Cannot apply scope patterns."));
            return [];
        }
        console.log(chalk.dim(`ScopeManager: Initial filtering (.gitignore) found ${initialFiles.length} files.`));

        // 3. Filter using 'ignore' library - POSIX paths are important for matching
        // Create separate filters for includes and excludes for clarity
        const includeFilter = ignore().add(allIncludes);
        const excludeFilter = ignore().add(allExcludes); // Add exclude patterns directly

        const finalFiles = initialFiles.filter(absolutePath => {
            // Convert to relative POSIX path for matching consistency
            const relativePosixPath = path.relative(projectRoot, absolutePath).split(path.sep).join(path.posix.sep);

            // Logic: A file is kept if it MATCHES an include pattern AND DOES NOT MATCH an exclude pattern.
            // ignore.ignores(path) returns true if the path *should be ignored* according to the patterns added.

            // Check if it matches includes: !includeFilter.ignores(path) means "keep this based on includes"
            const included = !includeFilter.ignores(relativePosixPath);

            // Check if it matches excludes: excludeFilter.ignores(path) means "this should be excluded"
            const excluded = allExcludes.length > 0 ? excludeFilter.ignores(relativePosixPath) : false; // Only check excludes if there are any

            return included && !excluded;
        });


        console.log(chalk.dim(`ScopeManager: Filtering with ${allIncludes.length} includes & ${allExcludes.length} excludes resulted in ${finalFiles.length} files.`));

        return finalFiles; // Return the final filtered list of absolute paths
    }
}
