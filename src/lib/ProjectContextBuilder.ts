// src/lib/ProjectContextBuilder.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { Config } from './Config';
import { countTokens } from './utils';
// --- ADDED IMPORTS ---
import { ScopeManager, Scope } from './ScopeManager';
// --- END ADDED IMPORTS ---

export class ProjectContextBuilder {
    private fs: FileSystem;
    private projectRoot: string;
    private config: Config;
    // --- ADDED SCOPE MANAGER INSTANCE ---
    private scopeManager: ScopeManager;
    // --- END ADDED SCOPE MANAGER INSTANCE ---

    constructor(fileSystem: FileSystem, projectRoot: string, config: Config) {
        this.fs = fileSystem;
        this.projectRoot = projectRoot;
        this.config = config;
        // --- INSTANTIATE SCOPE MANAGER ---
        this.scopeManager = new ScopeManager(config, fileSystem);
        // --- END INSTANTIATE SCOPE MANAGER ---
    }

    /**
     * Builds the context string based on files defined in scopes (if any),
     * otherwise uses all project files (respecting .gitignore).
     * Handles token limits based on configuration.
     * @returns An object containing the context string and its token count.
     */
    async build(): Promise<{ context: string; tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context...'));

        // --- MODIFICATION: Use ScopeManager to get file paths ---
        // Load scopes defined in the configuration file (e.g., .kai/scopes.yaml)
        const scopes: Scope[] = await this.scopeManager.loadScopes();

        // Resolve the actual list of files based on the loaded scopes.
        // If no scopes are loaded (file not found, empty, etc.),
        // resolveFilesForScopes defaults to returning all files (respecting .gitignore).
        const filePaths: string[] = await this.scopeManager.resolveFilesForScopes(scopes, this.projectRoot);
        // --- END MODIFICATION ---

        if (filePaths.length === 0) {
            // This can happen if no files match the scopes, or if .gitignore filters everything out.
            console.log(chalk.yellow("No files found matching the defined scopes or default filters. Context will be empty."));
            return { context: "Code Base Context:\n(No files found)", tokenCount: 5 }; // Provide minimal context
        }

        // Log which mechanism determined the file list
        if (scopes.length > 0) {
            console.log(chalk.blue(`Reading content for ${filePaths.length} files determined by loaded scopes...`));
        } else {
            console.log(chalk.blue(`Reading content for ${filePaths.length} files (default: all non-ignored)...`));
        }

        // Read content ONLY for the files determined by the scope resolution (or default)
        const fileContents = await this.fs.readFileContents(filePaths);

        let contextString = "Code Base Context:\n";
        let currentTokenCount = countTokens(contextString);
        // Use max_prompt_tokens from config, apply safety margin (e.g., 80%)
        // This margin leaves room for the user prompt, conversation history, instructions etc.
        const maxContextTokens = (this.config.gemini.max_prompt_tokens || 32000) * 0.80;
        let includedFiles = 0;
        let excludedFiles = 0; // Files excluded due to being empty/whitespace or token limits

        // Sort file paths for deterministic context order
        const sortedFilePaths = Object.keys(fileContents).sort();

        for (const absoluteFilePath of sortedFilePaths) {
            // Get relative path for display and context formatting
            const relativePath = path.relative(this.projectRoot, absoluteFilePath);
            let content = fileContents[absoluteFilePath]; // Already read

            // Skip if content is missing or empty after reading (shouldn't happen often with readFileContents check)
            if (!content) {
                console.log(chalk.gray(`  Skipping empty file: ${relativePath}`));
                excludedFiles++;
                continue;
            }

            // Optimize whitespace before token counting and inclusion
            content = this.optimizeWhitespace(content);
            if (!content) {
                console.log(chalk.gray(`  Skipping file with only whitespace: ${relativePath}`));
                excludedFiles++;
                continue;
            }

            // Format the file block for the context string
            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;

            // Add the file block to the context string
            contextString += fileBlock;
            currentTokenCount += fileTokens; // Update token count only if included
            includedFiles++;
            // Use dim for less important logs
            console.log(chalk.dim(`  Included ${relativePath} (${fileTokens} tokens). Current total: ${currentTokenCount.toFixed(0)}`));
        }

        // Final summary log
        const mechanism = scopes.length > 0 ? "scopes" : "default filters";
        console.log(chalk.blue(`Context built with ${includedFiles} files determined by ${mechanism} (${currentTokenCount.toFixed(0)} tokens). ${excludedFiles} files excluded/skipped (empty/whitespace/size). Max context: ${maxContextTokens.toFixed(0)} tokens.`));

        // Final check (mostly redundant due to per-file check, but safe)
        if (currentTokenCount > (this.config.gemini.max_prompt_tokens || 32000)) {
            console.warn(chalk.yellow(`Warning: Final context token count (${currentTokenCount}) exceeds configured max_prompt_tokens (${this.config.gemini.max_prompt_tokens}). Potential truncation by API.`));
        }

        return { context: contextString, tokenCount: currentTokenCount };
    }

    /**
     * Optimizes whitespace in a code string. (Unchanged)
     * @param code The code string.
     * @returns Optimized code string.
     */
    private optimizeWhitespace(code: string): string {
        code = code.replace(/[ \t]+$/gm, ''); // Remove trailing whitespace per line
        code = code.replace(/\r\n/g, '\n');   // Normalize line endings to LF
        code = code.replace(/\n{3,}/g, '\n\n'); // Collapse multiple blank lines to max one blank line
        code = code.trim();                 // Remove leading/trailing whitespace from the whole string
        return code;
    }
}