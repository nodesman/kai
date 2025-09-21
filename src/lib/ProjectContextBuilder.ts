// src/lib/ProjectContextBuilder.ts
import path from 'path';
import chalk from 'chalk';
import { AIClient } from './AIClient'; // <-- ADDED: Import AIClient
import { FileSystem } from './FileSystem';
import { Config } from './Config';
import { countTokens } from './utils';
import { GitService } from './GitService';
// --- ADDED: Import Analysis Cache Types ---
// Import ProjectAnalysisCache, AnalysisCacheEntry depends on the M1 or M2 structure being targeted
import { ProjectAnalysisCache, AnalysisCacheEntry } from './analysis/types'; // Adjust path if needed
import { AnalysisPrompts } from './analysis/prompts'; // Import prompts for dynamic context
import { Message } from './models/Conversation'; // Import Message type

export class ProjectContextBuilder {
    private fs: FileSystem;
    private gitService: GitService; // Already injected
    private aiClient: AIClient; // <-- ADDED: AIClient instance variable
    private projectRoot: string;
    config: Config; // Made public in a previous step? Keep public or use getter.

    // Update constructor to accept AIClient
    constructor(
        fileSystem: FileSystem,
        gitService: GitService, // <-- Add gitService parameter
        projectRoot: string,
        config: Config,
        aiClient: AIClient // <-- ADDED: Inject AIClient
    ) {
        this.fs = fileSystem;
        this.gitService = gitService; // <-- Assign injected GitService
        this.aiClient = aiClient; // <-- Assign injected AIClient
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
     * This expects config.context.mode to be 'full', 'analysis_cache', or 'dynamic'.
     * It should NOT be called when mode is still undefined.
     * @param userQuery Optional user query (needed for dynamic mode).
     * @param historySummary Optional conversation history summary (needed for dynamic mode).
     * @returns An object containing the context string and its token count.
     * @throws Error if config.context.mode is still undefined or cache is missing when required.
     * @throws Error if required arguments for dynamic mode are missing.
     */
    async buildContext(
        userQuery?: string,
        historySummary?: string | null // Corrected: Expects string | null, not Message[]
    ): Promise<{ context: string; tokenCount: number }> {
        const contextMode = this.config.context.mode;

        if (contextMode === 'analysis_cache') {
            console.log(chalk.blue('\nBuilding project context using analysis cache...'));
            const cachePath = path.resolve(this.projectRoot, this.config.analysis.cache_file_path);
            const cacheData = await this.fs.readAnalysisCache(cachePath);

            // Check if cache exists and has entries (M2 check)
            if (cacheData && cacheData.entries && cacheData.entries.length > 0) { // M2 check: object exists, entries array exists and is not empty
                return this._formatCacheAsContext(cacheData); // Pass object for M2 formatting
            } else if (cacheData && cacheData.entries && cacheData.entries.length === 0) { // M2 check: cache object exists but entries are empty
                 // Handle case where cache exists but is empty
                 console.log(chalk.yellow(`Analysis cache is empty at ${cachePath}. Building empty context.`));
                 return { context: 'Project Analysis Cache is empty.', tokenCount: 5 }; // Return minimal context
            } else {
                // If mode is explicitly 'analysis_cache' but cache is missing/invalid, it's an error state.
                // The startup logic should have prevented this by forcing analysis or exiting.
                // Log error and throw.
                console.error(chalk.red(`Error: Context mode is 'analysis_cache' but cache is missing, invalid, or empty at ${cachePath}.`));
                throw new Error(`Cannot build context: Analysis cache required but missing/invalid/empty at ${cachePath}.`);
            }
        } else if (contextMode === 'full') {
            return this._buildFullContext();
        } else if (contextMode === 'dynamic') {
            if (!userQuery) {
                 throw new Error("User query is required for 'dynamic' context mode.");
            }
            console.log(chalk.blue('\nBuilding dynamic project context...'));
            // Pass the already summarized history
             // Ensure we pass string | null, not undefined, using nullish coalescing on the parameter
             return this.buildDynamicContext(userQuery, historySummary ?? null);
        } else {
             // This should not happen if startup logic works correctly
            throw new Error(`Internal Error: Invalid or undetermined context mode '${contextMode}' encountered during context building. Mode determination failed or was skipped.`);
        }
    }

    /** Builds context by reading all project files. */
    private async _buildFullContext(): Promise<{ context: string; tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context (reading all text files)...')); // Updated log message
        const ignoreRules = await this.gitService.getIgnoreRules(this.projectRoot);
        const filePaths = await this.fs.getProjectFiles(this.projectRoot, this.projectRoot, ignoreRules);
        // Read with limited concurrency to avoid too many open files
        const fileContents = await this.fs.readFileContents(filePaths, 12);

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

        // Read contents with bounded concurrency, then compute token estimates
        const contents = await this.fs.readFileContents(filePaths, 12);
        for (const filePath of Object.keys(contents)) {
            const relativePath = path.relative(this.projectRoot, filePath);
            const content = contents[filePath];
            if (!content || !content.trim()) continue;
            const optimizedContent = this.optimizeWhitespace(content);
            if (!optimizedContent) continue;
            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            totalTokenCount += countTokens(fileHeader) + countTokens(optimizedContent) + countTokens(fileFooter);
            includedFiles++;
        }

        console.log(chalk.dim(`Estimated token count for ${includedFiles} files: ${totalTokenCount}`));
        return totalTokenCount;
    }

    /** Formats the loaded analysis cache data (M2 object structure) into a context string. */
    private _formatCacheAsContext(cacheData: ProjectAnalysisCache): { context: string; tokenCount: number } {
        // --- M2 Formatting ---
        let contextString = `Project Analysis Overview:\n${cacheData.overallSummary || "(No overall summary provided)"}\n\nFile Details:\n`;
        // Filter out entries that shouldn't clutter the context? Or keep all? Keep all for now.
        const entries = cacheData.entries;

        for (const entry of entries) {
            contextString += `\n---\nFile: ${entry.filePath}`;
            // Add type/size info, especially if no summary exists
            if (entry.type !== 'text_analyze' && entry.summary === null) { // Show details only if NOT analyzed text
                  contextString += ` [${entry.type.replace('_', ' ')}] (Size: ${(entry.size / 1024).toFixed(1)} KB`;
                  if (entry.loc !== null) contextString += `, LOC: ${entry.loc}`;
                  contextString += `)`;
            } else if (entry.loc !== null) { // Add LOC for analyzed files too
                 contextString += ` (LOC: ${entry.loc})`;
            }
            // Only include summary if it exists
            if (entry.summary) {
                 contextString += `\nSummary: ${entry.summary}\n`;
            } else {
                 contextString += `\nSummary: (Not summarized)\n`; // Indicate it wasn't summarized
            }
        }
        // --- End M2 formatting ---

        const finalTokenCount = countTokens(contextString); // Count tokens of the formatted string
        console.log(chalk.blue(`Analysis cache context built with ${entries.length} entries.`));
        console.log(chalk.blue(`Final calculated context token count: ${finalTokenCount}`));
        return { context: contextString, tokenCount: finalTokenCount };
    }

    /**
     * Creates a concise string summary of the analysis cache for the relevance check prompt.
     */
    private _formatCacheForRelevance(cacheData: ProjectAnalysisCache): string {
         let summaryString = "Available Files Overview:\n";
         for (const entry of cacheData.entries) {
              // Include essential info: path, type, size, and summary if available
              summaryString += `- ${entry.filePath} [${entry.type.replace('_', ' ')}] (Size: ${(entry.size / 1024).toFixed(1)} KB)`;
              if (entry.summary) {
                   summaryString += ` - Summary: ${entry.summary.substring(0, 100)}${entry.summary.length > 100 ? '...' : ''}`; // Truncate summary
              }
              summaryString += "\n";
         }
         return summaryString;
    }

    /**
     * Builds context dynamically by selecting relevant files based on summaries. (Milestone 3)
     * @param userQuery The user's current query.
     * @param historySummary Optional summary of recent conversation history.
     */
    async buildDynamicContext(
        userQuery: string,
        historySummary: string | null
    ): Promise<{ context: string; tokenCount: number }> {
        const cachePath = path.resolve(this.projectRoot, this.config.analysis.cache_file_path);
        const cacheData = await this.fs.readAnalysisCache(cachePath);

        if (!cacheData || !cacheData.entries || cacheData.entries.length === 0) {
            console.warn(chalk.yellow("Dynamic mode requires analysis cache, but it's missing or empty. Falling back to empty context."));
            // Or potentially fall back to _buildFullContext if small enough? For now, empty.
            return { context: "CONTEXT: Project analysis cache is missing or empty.", tokenCount: 10 };
        }

        // 1. Calculate budget for file content
        const maxTotalTokens = this.config.gemini.max_prompt_tokens || 32000;
        // Estimate base prompt (query, history summary, instructions, separators, etc.) - needs refinement
        const basePromptEstimate = countTokens(userQuery) + (historySummary ? countTokens(historySummary) : 0) + 500; // Rough estimate for system instructions, formatting etc.
        const fileContentBudget = maxTotalTokens - basePromptEstimate;
        if (fileContentBudget <= 0) {
             console.warn(chalk.yellow(`Warning: Base prompt estimate (${basePromptEstimate}) exceeds max tokens (${maxTotalTokens}). Dynamic context cannot include file content.`));
             // Return just the query/history/cache summary? Or error? Return cache summary for now.
              return this._formatCacheAsContext(cacheData); // Fallback to cache summary context
        }
        console.log(chalk.dim(`  Dynamic Context: Calculated file content budget: ~${fileContentBudget} tokens.`));

        // 2. Format cache for relevance check
        const cacheSummaryForPrompt = this._formatCacheForRelevance(cacheData);

        // 3. AI Relevance Check (Call 1 - Flash)
        const relevancePrompt = AnalysisPrompts.selectRelevantFilesPrompt(userQuery, historySummary, cacheSummaryForPrompt, fileContentBudget);
        // Optionally prepend dynamic mode guidelines from Kai-dynamic.md if present
        let relevancePromptFinal = relevancePrompt;
        try {
            const dynamicGuidePath = path.resolve(this.projectRoot, 'Kai-dynamic.md');
            const dynContent = await this.fs.readFile(dynamicGuidePath);
            if (dynContent && dynContent.trim()) {
                relevancePromptFinal = `GUIDELINES (Dynamic Mode):\n${dynContent.trim()}\n\n---\n${relevancePrompt}`;
            }
        } catch (e) {
            // ignore missing
        }
        let selectedPaths: string[] = [];
        try {
            console.log(chalk.dim(`  Asking AI (Flash) to select relevant files...`));
            const response = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: relevancePromptFinal }],
                true // Use Flash model
            );
            selectedPaths = response.trim().split('\n').map(p => p.trim()).filter(p => p && p !== "NONE"); // Split by newline, trim, filter empty/NONE
            console.log(chalk.dim(`  AI selected ${selectedPaths.length} potential files:`), selectedPaths);
        } catch (error) {
            console.error(chalk.red("  Error during AI relevance check:"), error);
            // Decide how to proceed: empty context? fallback to cache summary? Fallback for now.
            console.warn(chalk.yellow("  Falling back to analysis cache context due to relevance check error."));
             return this._formatCacheAsContext(cacheData);
        }

        if (selectedPaths.length === 0) {
             console.log(chalk.yellow("  AI did not select any relevant files. Using analysis cache context."));
              return this._formatCacheAsContext(cacheData);
        }

        // 4. Load Full Files & Assemble Final Context (respecting actual token limit)
        // Start with base prompt elements that MUST be included
        console.log(chalk.dim(`  Assembling selected file contents into context (up to ~${maxTotalTokens} tokens).`));
        let finalContext = `User Query: ${userQuery}\n${historySummary ? `History Summary: ${historySummary}\n` : ''}--- Relevant File Context ---\n`;
        let currentTokenCount = countTokens(finalContext);
        const includedFiles: string[] = [];

        // Prefetch selected files with limited concurrency
        const normalizedToAbs = new Map<string, string>();
        const absPaths: string[] = [];
        for (const p of selectedPaths) {
            const normalizedPath = path.normalize(p).replace(/\\/g, '/');
            if (!normalizedPath || normalizedPath.startsWith('..')) {
                console.warn(chalk.yellow(`    Skipping invalid/suspicious path from AI: ${p}`));
                continue;
            }
            const absolutePath = path.resolve(this.projectRoot, normalizedPath);
            normalizedToAbs.set(normalizedPath, absolutePath);
            absPaths.push(absolutePath);
        }

        const contentsMap = await this.fs.readFileContents(absPaths, 12);

        for (const sel of selectedPaths) {
            const normalizedPath = path.normalize(sel).replace(/\\/g, '/');
            const absolutePath = normalizedToAbs.get(normalizedPath);
            if (!absolutePath) continue;
            const content = contentsMap[absolutePath];
            if (content === undefined) {
                console.warn(chalk.yellow(`    Skipping selected file (not found/readable): ${normalizedPath}`));
                continue;
            }
            const fileBlock = `\n---\nFile: ${normalizedPath}\n\`\`\`\n${content}\n\`\`\`\n`;
            const blockTokens = countTokens(fileBlock);

            if ((currentTokenCount + blockTokens) > maxTotalTokens) {
                console.warn(chalk.yellow(`    Skipping selected file (exceeds total token limit): ${normalizedPath}`));
                continue;
            }

            finalContext += fileBlock;
            currentTokenCount += blockTokens;
            includedFiles.push(normalizedPath);
            console.log(chalk.dim(`    Included: ${normalizedPath} (+${blockTokens} tokens). Total: ${currentTokenCount}`));
        }

        console.log(chalk.blue(`Dynamic context built with ${includedFiles.length} files. Final token count: ${currentTokenCount}`));
        return { context: finalContext, tokenCount: currentTokenCount };
    }

     // REMOVED: _summarizeHistory method (moved to ConversationManager)

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
