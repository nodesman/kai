// src/lib/analysis/ProjectAnalyzerService.ts
import path from 'path';
import chalk from 'chalk';
import fs from 'fs/promises'; // Use promises fs for stats
import { Config } from '../Config';
import { FileSystem } from '../FileSystem';
import { CommandService } from '../CommandService';
import { GitService } from '../GitService'; // <-- ADDED GitService Import
import { AIClient } from '../AIClient';
import { AnalysisCacheEntry, ProjectAnalysisCache } from './types';
import { AnalysisPrompts } from './prompts'; // Use the new prompts file
import { countTokens } from '../utils'; // Needed if we add token limits later

// Simple thresholds for this milestone (can be adjusted/made configurable later)
const MAX_FILE_SIZE_FOR_BATCH_BYTES = 150 * 1024; // Reduce max individual file size for batching (150KB)
const BATCH_TOKEN_TARGET_PERCENTAGE = 0.75; // Target 75% of max prompt tokens for safety buffer

export class ProjectAnalyzerService {
    private config: Config;
    private fsUtil: FileSystem;
    private commandService: CommandService;
    private gitService: GitService; // <-- ADDED GitService instance variable
    private aiClient: AIClient;
    private projectRoot: string;

    constructor(
        config: Config,
        fsUtil: FileSystem,
        commandService: CommandService,
        gitService: GitService, // <-- ADDED GitService parameter
        aiClient: AIClient
    ) {
        this.config = config;
        this.fsUtil = fsUtil;
        this.commandService = commandService;
        this.gitService = gitService; // <-- Assign GitService
        this.aiClient = aiClient;
        this.projectRoot = process.cwd();
    }

    /**
     * Runs the project analysis process using batching (Refined Milestone 1).
     */
    async analyzeProject(): Promise<void> {
        console.log(chalk.cyan("\n🚀 Starting project analysis (Batch Mode)..."));
        const cacheFilePath = path.resolve(this.projectRoot, this.config.analysis.cache_file_path);
        const analysisCache: ProjectAnalysisCache = []; // Still produces the M1 array structure
        const timestamp = new Date().toISOString();

        try {
            // 1. Get file list (filtered by ignore rules)
            const fileList = await this._listFiles();
            if (!fileList || fileList.length === 0) {
                console.log(chalk.yellow("  No files found to analyze (after filtering). Skipping cache generation."));
                await this.fsUtil.writeAnalysisCache(cacheFilePath, []); // Write empty cache if no files
                return;
            }
            console.log(chalk.blue(`  Found ${fileList.length} files for analysis (after filtering). Preparing batches...`));

            // --- Filter files suitable for batch analysis ---
            const filesToSummarize: { path: string; size: number; loc: number }[] = [];
            for (const relativePath of fileList) {
                const absolutePath = path.resolve(this.projectRoot, relativePath);
                try {
                    const stats = await this.fsUtil.stat(absolutePath);
                    if (!stats || stats.size === 0) continue; // Skip if stat fails or empty
                    // --- ADDED: Explicitly skip directories ---
                    if (stats.isDirectory()) {
                        console.log(chalk.grey(`    Skipping directory: ${relativePath}`));
                        continue;
                    }
                    if (stats.size > MAX_FILE_SIZE_FOR_BATCH_BYTES) {
                         console.log(chalk.grey(`    Skipping large file from batching (${(stats.size / 1024).toFixed(1)} KB): ${relativePath}`));
                         continue;
                    }
                    if (!(await this.fsUtil.isTextFile(absolutePath))) {
                         console.log(chalk.grey(`    Skipping non-text file from batching: ${relativePath}`));
                         continue;
                    }
                    // Read content briefly to count lines (avoiding full read if possible later)
                    const content = await this.fsUtil.readFile(absolutePath);
                    if (content === null || !content.trim()) continue; // Skip empty/unreadable
                    const loc = content.split('\n').length;
                    filesToSummarize.push({ path: relativePath, size: stats.size, loc });

                } catch (err) {
                     console.warn(chalk.yellow(`    Warning: Error checking file ${relativePath} for batching. Skipping. Error: ${(err as Error).message}`));
                }
            }
             console.log(chalk.blue(`  Will attempt to summarize ${filesToSummarize.length} suitable files in batches.`));

            // --- Process files in batches ---
            const maxBatchTokens = (this.config.gemini.max_prompt_tokens || 32000) * BATCH_TOKEN_TARGET_PERCENTAGE;
            let analyzedCount = 0;
            let errorCount = 0;
            let currentBatchFiles: { path: string; size: number; loc: number }[] = [];
            let currentBatchContent = "";
            let currentBatchTokenEstimate = 0; // Estimate based on size for batch building
            const SIZE_TO_TOKEN_RATIO = 0.3; // Very rough estimate: 1 char ~= 0.3 tokens average (adjust!)
            const BASE_PROMPT_TOKEN_ESTIMATE = 200; // Estimate for the batch prompt overhead

            currentBatchTokenEstimate += BASE_PROMPT_TOKEN_ESTIMATE;

            for (let i = 0; i < filesToSummarize.length; i++) {
                const fileInfo = filesToSummarize[i];
                const estimatedFileTokens = fileInfo.size * SIZE_TO_TOKEN_RATIO; // Rough estimate
                const fileHeader = `\n---\nFile: ${fileInfo.path}\n\`\`\`\n`;
                const fileFooter = "\n```\n";
                const estimatedOverhead = countTokens(fileHeader + fileFooter); // More accurate overhead count
                const estimatedTotalCost = estimatedFileTokens + estimatedOverhead;

                // Check if adding this file exceeds the token limit for the batch
                if (currentBatchFiles.length > 0 && (currentBatchTokenEstimate + estimatedTotalCost) > maxBatchTokens) {
                    // Process the current batch *before* adding the new file
                    console.log(chalk.cyan(`    Batch full (${currentBatchFiles.length} files, ~${currentBatchTokenEstimate.toFixed(0)} tokens). Processing...`));
                    const batchResult = await this._processBatch(currentBatchFiles, currentBatchContent, timestamp);
                    analysisCache.push(...batchResult.entries);
                    analyzedCount += batchResult.successCount;
                    errorCount += batchResult.errorCount;

                    // Reset for the next batch
                    currentBatchFiles = [];
                    currentBatchContent = "";
                    currentBatchTokenEstimate = BASE_PROMPT_TOKEN_ESTIMATE;
                }

                // Add the current file to the (potentially new) batch
                // Need to read content now for the actual prompt string
                const absolutePath = path.resolve(this.projectRoot, fileInfo.path);
                const content = await this.fsUtil.readFile(absolutePath);
                if (content === null) { // Should not happen based on earlier check, but be safe
                    console.warn(chalk.yellow(`    Warning: Could not read file ${fileInfo.path} when adding to batch. Skipping.`));
                    continue;
                }
                const fileBlock = fileHeader + content + fileFooter;

                currentBatchFiles.push(fileInfo);
                currentBatchContent += fileBlock;
                // Use actual token count now that we have content for a better estimate within the batch
                currentBatchTokenEstimate += countTokens(fileBlock); // Update estimate more accurately
                console.log(chalk.dim(`      Added to batch: ${fileInfo.path} (~${countTokens(fileBlock)} tokens). Batch total estimate: ${currentBatchTokenEstimate.toFixed(0)}`));
            }

            // Process the final batch if it has files
            if (currentBatchFiles.length > 0) {
                console.log(chalk.cyan(`    Processing final batch (${currentBatchFiles.length} files, ~${currentBatchTokenEstimate.toFixed(0)} tokens)...`));
                const batchResult = await this._processBatch(currentBatchFiles, currentBatchContent, timestamp);
                analysisCache.push(...batchResult.entries);
                analyzedCount += batchResult.successCount;
                errorCount += batchResult.errorCount;
            }

            console.log(chalk.blue(`\nBatch processing finished. Summarized: ${analyzedCount} files, Errors: ${errorCount}.`));

            // 3. Write the cache
            // Sort the final cache by file path
            analysisCache.sort((a, b) => a.filePath.localeCompare(b.filePath));

            if (analysisCache.length > 0 || errorCount === 0) { // Only write if something was analyzed or no errors occurred
                await this.fsUtil.writeAnalysisCache(cacheFilePath, analysisCache);
                console.log(chalk.green(`✅ Project analysis complete. Cache saved to ${cacheFilePath}`));
            } else {
                 console.error(chalk.red(`❌ Project analysis finished with errors and no files summarized. Cache NOT saved.`));
            }

        } catch (error) {
            console.error(chalk.red("\n❌ Fatal error during project analysis:"), error);
            // Consider cleanup or specific error reporting
        }
    }

    /** Processes a single batch of files by calling the AI and parsing the response. */
    private async _processBatch(
        batchFiles: { path: string; size: number; loc: number }[],
        batchContent: string,
        timestamp: string
    ): Promise<{ entries: AnalysisCacheEntry[], successCount: number, errorCount: number }> {
        const batchEntries: AnalysisCacheEntry[] = [];
        let successCount = 0;
        let errorCount = 0;
        const filePathsInBatch = batchFiles.map(f => f.path);

        try {
            const prompt = AnalysisPrompts.batchSummarizePrompt(batchContent, filePathsInBatch);
            const responseJsonString = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: prompt }],
                true // USE FLASH MODEL for batches
            );

            // Parse the JSON response
            const parsedSummaries = this._parseBatchResponse(responseJsonString, filePathsInBatch);

            // Create cache entries for this batch
            for (const fileInfo of batchFiles) {
                const summary = parsedSummaries[fileInfo.path]; // Get summary from parsed response
                try {
                    if (summary) {
                        batchEntries.push({
                            filePath: fileInfo.path,
                            loc: fileInfo.loc,
                            summary: summary,
                            lastAnalyzed: timestamp
                        });
                        successCount++;
                    } else {
                         // AI missed summary for this file
                         console.warn(chalk.yellow(`      Warning: AI response missing summary for ${fileInfo.path}`));
                         batchEntries.push({
                             filePath: fileInfo.path,
                             loc: fileInfo.loc,
                             summary: "[Summary not provided by AI]", // Indicate missing summary
                             lastAnalyzed: timestamp
                         });
                         errorCount++; // Count missing summary as an error for the batch
                    }
                } catch (fileError) {
                     // Error creating the entry itself (should be rare)
                     console.error(chalk.red(`      Error creating cache entry for ${fileInfo.path}:`), fileError);
                     errorCount++;
                }
            }

        } catch (batchError) {
            console.error(chalk.red(`    Error processing batch: ${(batchError as Error).message}`));
            errorCount = batchFiles.length; // Mark all files in batch as failed
            // Create error entries for all files in the failed batch
            for (const fileInfo of batchFiles) {
                batchEntries.push({
                     filePath: fileInfo.path,
                     loc: fileInfo.loc,
                     summary: "[Batch Processing Error]",
                     lastAnalyzed: timestamp
                 });
            }
        }

        return { entries: batchEntries, successCount, errorCount };
    }

    /** Parses the JSON response from the batch analysis prompt */
    private _parseBatchResponse(
        rawJsonText: string,
        expectedFilePaths: string[]
    ): { [filePath: string]: string | null } {
        const summaries: { [filePath: string]: string | null } = {};
        // Initialize all expected paths with null
        expectedFilePaths.forEach(p => summaries[p] = null);

        try {
             let cleanJsonText = rawJsonText.trim();
             const jsonMatch = cleanJsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
             if (jsonMatch && jsonMatch[1]) {
                 cleanJsonText = jsonMatch[1].trim();
             } else if (!cleanJsonText.startsWith('{') || !cleanJsonText.endsWith('}')) {
                  throw new Error("Response does not appear to be a JSON object and is not wrapped in markdown fences.");
             }

             const parsed = JSON.parse(cleanJsonText);

             if (typeof parsed !== 'object' || parsed === null || typeof parsed.summaries !== 'object' || parsed.summaries === null) {
                 throw new Error("Parsed response missing 'summaries' object.");
             }

             // Populate summaries from the parsed response
             for (const filePath in parsed.summaries) {
                 if (expectedFilePaths.includes(filePath)) { // Check if the key is one we asked for
                     if (typeof parsed.summaries[filePath] === 'string') {
                         summaries[filePath] = parsed.summaries[filePath];
                     } else {
                         console.warn(chalk.yellow(`      Warning: Invalid summary type for ${filePath} in AI response (expected string).`));
                     }
                 } else {
                      console.warn(chalk.yellow(`      Warning: AI returned summary for unexpected file: ${filePath}`));
                 }
             }
             return summaries;

        } catch (e) {
            console.error(chalk.red(`      Failed to parse batch analysis JSON response. Raw text: ${rawJsonText}`), e);
            // Return the initialized object with nulls, indicating parsing failure for all
            return summaries;
        }
    }

    /**
     * Lists project files, prioritizing `phind`, falling back to `find`,
     * and then filtering the results using .gitignore rules.
     * Does NOT use configuration for the command.
     */
    private async _listFiles(): Promise<string[]> {
        let commandToRun: string;
        let commandName: string;

        // Check if 'phind' exists
        try {
            await this.commandService.run('command -v phind', { cwd: this.projectRoot }); // Simple POSIX check
            commandName = 'phind';
            commandToRun = 'phind .';
            console.log(chalk.dim(`    Found 'phind' command. Using it to list files.`));
        } catch (error) {
            // Assuming error means 'phind' is not found or check failed
            commandName = 'find';
            commandToRun = 'find . -type f';
            console.log(chalk.dim(`    'phind' not found or check failed. Falling back to '${commandName}'.`));
        }

        // Execute the chosen command
        let rawFileList: string[] = [];
        try {
            console.log(chalk.dim(`    Executing file list command: ${commandToRun}`));
            const { stdout } = await this.commandService.run(commandToRun, { cwd: this.projectRoot });
            rawFileList = stdout.trim().split('\n').filter(line => line.trim() !== '' && line !== '.'); // Filter empty lines and '.'
        } catch (error) {
            console.error(chalk.red(`Error running file listing command "${commandToRun}":`), error);
            throw new Error(`Failed to list project files using command: ${commandToRun}.`);
        }

        // --- Filter using .gitignore ---
        console.log(chalk.dim(`    Filtering ${rawFileList.length} raw files using ignore rules...`));
        const ignoreRules = await this.gitService.getIgnoreRules(this.projectRoot);
        const filteredList = rawFileList.filter(rawPath => {
            const normalizedPath = path.normalize(rawPath).replace(/^[./\\]+/, ''); // Normalize for ignore check
            // Ensure the path is not empty after normalization and is not ignored
            return normalizedPath && !ignoreRules.ignores(normalizedPath);
        });
        console.log(chalk.dim(`    Filtered list size: ${filteredList.length}`));
        return filteredList;
        // --- End Filter ---
    }

}