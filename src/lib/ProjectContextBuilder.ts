// src/lib/ProjectContextBuilder.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { Config } from './Config';
import { countTokens } from './utils';
import { GitService } from './GitService';
// --- ADDED: Import Analysis Cache Types ---
import { ProjectAnalysisCache, AnalysisCacheEntry } from './analysis/types'; // Adjust path if needed

export class ProjectContextBuilder {
    private fs: FileSystem;
    private projectRoot: string;
    public config: Config; // Made public or add setter if needed after instantiation in kai.ts
    private gitService: GitService; // <-- Add GitService instance variable

    // Update constructor to accept GitService
    constructor(
        fileSystem: FileSystem,
        gitService: GitService, // <-- Add gitService parameter
        projectRoot: string,
        config: Config
        // Add any other dependencies like config if needed
    ) {
        this.fs = fileSystem;
        this.gitService = gitService; // <-- Assign injected GitService
        this.projectRoot = projectRoot;
        this.config = config;
    }

    /**
     * Reads project files, applies ignores (using GitService), optimizes content, and builds the context string.
     * Includes ALL detected text files without enforcing token limits.
     * @returns An object containing the context string and its total token count.
     * @deprecated Use buildContext which respects config.context.mode.
     */
    async build(): Promise<{ context: string; tokenCount: number }> {
         console.warn(chalk.yellow("Warning: ProjectContextBuilder.build() is deprecated. Use buildContext() which respects config.context.mode."));
         return this.buildContext(); // Call the new method
     }


    /**
     * Builds the project context string based on the *final determined* context mode from config.
     * This expects config.context.mode to be either 'full' or 'analysis_cache'.
     * It should NOT be called when mode is still undefined.
     * @returns An object containing the context string and its token count.
     * @throws Error if config.context.mode is still undefined or cache is missing when required.
     */
    async buildContext(): Promise<{ context: string; tokenCount: number }> {
        const contextMode = this.config.context.mode;

        if (contextMode === 'analysis_cache') {
            console.log(chalk.blue('\nBuilding project context using analysis cache...'));
            const cachePath = path.resolve(this.projectRoot, this.config.analysis.cache_file_path);
            const cacheData = await this.fs.readAnalysisCache(cachePath);

            if (cacheData && cacheData.length > 0) {
                return this._formatCacheAsContext(cacheData);
            } else {
                // If mode is explicitly 'analysis_cache' but cache is missing/empty, it's an error state.
                // The startup logic should have prevented this by forcing analysis or exiting.
                // Log error and throw.
                console.error(chalk.red(`Error: Context mode is 'analysis_cache' but cache is missing or empty at ${cachePath}.`));
                throw new Error(`Cannot build context: Analysis cache required but missing/empty at ${cachePath}.`);
            }
        } else if (contextMode === 'full') {
            return this._buildFullContext();
        } else {
            // This should not happen if startup logic works correctly
            // It means the mode is still undefined when building context.
            throw new Error(`Internal Error: Invalid or undetermined context mode '${contextMode}' encountered during context building. Mode determination failed or was skipped.`);
        }
    }

    /** Builds context by reading all project files. */
    private async _buildFullContext(): Promise<{ context: string; tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context (reading all text files)...')); // Updated log message
        const ignoreRules = await this.gitService.getIgnoreRules(this.projectRoot);
        const filePaths = await this.fs.getProjectFiles(this.projectRoot, this.projectRoot, ignoreRules);
        const fileContents = await this.fs.readFileContents(filePaths);

        let contextString = "Code Base Context:\n";
        let includedFiles = 0;
        const sortedFilePaths = Object.keys(fileContents).sort();

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];
            // No need to check for empty content here, readFileContents handles missing files
            // isTextFile check is done within getProjectFiles
            content = this.optimizeWhitespace(content);
            if (!content) {
                console.log(chalk.gray(`  Skipping file with only whitespace: ${relativePath}`));
                continue;
            }

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;
             // Add token counting for the block if needed for limits later
            contextString += fileBlock;
            includedFiles++;
            console.log(chalk.dim(`  Included ${relativePath}`));
        }

        const finalTokenCount = countTokens(contextString);

        console.log(chalk.blue(`Full context built with ${includedFiles} files.`));
        console.log(chalk.blue(`Final calculated context token count: ${finalTokenCount}`));

        return { context: contextString, tokenCount: finalTokenCount };
    }

    /**
     * Estimates the token count for the full project context without building the string.
     * This is faster for large projects when only the count is needed for mode selection.
     * Respects .gitignore rules.
     * @returns The estimated total token count.
     */
    async estimateFullContextTokens(): Promise<number> {
        console.log(chalk.dim('\nEstimating full project context token count...'));
        const ignoreRules = await this.gitService.getIgnoreRules(this.projectRoot);
        const filePaths = await this.fs.getProjectFiles(this.projectRoot, this.projectRoot, ignoreRules);

        let totalTokenCount = countTokens("Code Base Context:\n"); // Base token count
        let includedFiles = 0;

        // Process files asynchronously for potentially better performance, though token counting is CPU-bound
        const tokenPromises = filePaths.map(async (filePath) => {
            const relativePath = path.relative(this.projectRoot, filePath);
            const content = await this.fs.readFile(filePath); // readFile handles ENOENT -> null
            if (content === null || !content.trim()) {
                // console.log(chalk.gray(`  (Estimate) Skipping empty/unreadable file: ${relativePath}`));
                return 0; // No tokens for empty/unreadable files
            }
            const optimizedContent = this.optimizeWhitespace(content);
            if (!optimizedContent) {
                // console.log(chalk.gray(`  (Estimate) Skipping file with only whitespace: ${relativePath}`));
                return 0; // No tokens if only whitespace after optimization
            }

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            // Estimate tokens for header, footer, and content
            const blockTokenCount = countTokens(fileHeader) + countTokens(optimizedContent) + countTokens(fileFooter);
            includedFiles++; // Count files contributing tokens
            return blockTokenCount;
        });

        const tokenCounts = await Promise.all(tokenPromises);
        totalTokenCount += tokenCounts.reduce((sum, count) => sum + count, 0);

        console.log(chalk.dim(`Estimated token count for ${includedFiles} files: ${totalTokenCount}`));
        return totalTokenCount;
    }

    /** Formats the loaded analysis cache data (simple array for M1) into a context string. */
    private _formatCacheAsContext(cacheData: ProjectAnalysisCache): { context: string; tokenCount: number } {
        // --- Format the simple array ---
        let contextString = "Project Analysis Summary:\n";
        // Ensure cacheData is treated as AnalysisCacheEntry[]
        const entries = cacheData as AnalysisCacheEntry[];
        for (const entry of entries) {
            contextString += `\n---\nFile: ${entry.filePath} (LOC: ${entry.loc})\nSummary: ${entry.summary}\n`;
        }
        // --- End formatting ---

        const finalTokenCount = countTokens(contextString); // Count tokens of the formatted string
        console.log(chalk.blue(`Analysis cache context built with ${cacheData.length} entries.`));
        console.log(chalk.blue(`Final calculated context token count: ${finalTokenCount}`));
        return { context: contextString, tokenCount: finalTokenCount };
    }


    /**
     * Optimizes whitespace in a code string.
     * @param code The code string.
     * @returns Optimized code string.
     */
    private optimizeWhitespace(code: string): string {
        // (implementation remains unchanged)
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\r\n/g, '\n');
        code = code.replace(/\n{3,}/g, '\n\n');
        code = code.trim();
        return code;
    }
}