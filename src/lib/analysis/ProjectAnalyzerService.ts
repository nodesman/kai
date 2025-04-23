// src/lib/analysis/ProjectAnalyzerService.ts
import path from 'path';
import chalk from 'chalk';
// import fs from 'fs/promises'; // Removed unused import
import { Config } from '../Config';
import { FileSystem } from '../FileSystem';
import { CommandService } from '../CommandService';
import { GitService } from '../GitService'; // <-- ADDED GitService Import
import { AIClient } from '../AIClient';
import { AnalysisCacheEntry, ProjectAnalysisCache } from './types';
import { AnalysisPrompts } from './prompts'; // Use the new prompts file
import { countTokens } from '../utils'; // Needed if we add token limits later

// Simple thresholds for this milestone (can be adjusted/made configurable later)
// Keep thresholds for classifying large files
const LARGE_FILE_SIZE_THRESHOLD_BYTES = 100 * 1024; // 100 KB
const LARGE_FILE_LOC_THRESHOLD = 5000; // 5000 lines
const MAX_FILE_SIZE_FOR_BATCH_BYTES = 150 * 1024; // Max individual file size to include in batching (150KB) - Used in Phase 2
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
     * Runs the enhanced project analysis process (Milestone 2).
     * Phase 1: Inventory & Classification
     * Phase 2: Simple Summarization (only for suitable files)
     * Phase 3: Cache Assembly & Saving
     */
    async analyzeProject(): Promise<void> {
        console.log(chalk.cyan("\n🚀 Starting project analysis (Milestone 2)..."));
        const cacheFilePath = path.resolve(this.projectRoot, this.config.analysis.cache_file_path);
        const allEntries: AnalysisCacheEntry[] = []; // Holds all entries (binary, large, analyzed)
        const timestamp = new Date().toISOString();
        let overallSummary: string | null = null; // Placeholder for M2

        try {
            // === Phase 1: Inventory and Classification ===
            console.log(chalk.blue("  Phase 1: Inventorying and classifying files..."));
            const initialInventory = await this._gatherInitialInventory(timestamp);
            if (!initialInventory || initialInventory.length === 0) {
                console.log(chalk.yellow("  No files found to analyze (after filtering). Creating empty cache."));
                // Write empty cache if nothing found
                await this.fsUtil.writeAnalysisCache(cacheFilePath, { overallSummary: "No files found.", entries: [] });
                return;
            }
            allEntries.push(...initialInventory); // Add all classified entries

            // Identify files needing summary
            const filesToSummarize = allEntries.filter(entry => entry.type === 'text_analyze');
            console.log(chalk.blue(`  Inventory complete: Found ${allEntries.length} total items.`));
            console.log(chalk.blue(`           Identified ${filesToSummarize.length} text files for AI analysis.`));
            console.log(chalk.blue(`           Identified ${allEntries.length - filesToSummarize.length} binary/large files (will be listed).`));

            // === Phase 2: Summary Generation using Batching (for 'text_analyze' files) ===
            console.log(chalk.blue("\n  Phase 2: Generating summaries for suitable files using batching..."));
            let { analyzedCount, errorCount } = await this._runSummaryGeneration(filesToSummarize, allEntries);
            console.log(chalk.blue(`\nSummary generation finished. Summarized: ${analyzedCount}, Errors during summary: ${errorCount}.`));
            overallSummary = `Analysis Pass Completed: ${analyzedCount} files summarized, ${allEntries.length - filesToSummarize.length} binary/large files listed.`;

            // === Phase 3: Cache Assembly & Saving ===
            console.log(chalk.blue("\n  Phase 3: Assembling and saving cache..."));
            const finalCache: ProjectAnalysisCache = {
                overallSummary: overallSummary,
                entries: allEntries.sort((a, b) => a.filePath.localeCompare(b.filePath)) // Sort entries by path
            };

            await this.fsUtil.writeAnalysisCache(cacheFilePath, finalCache);
            console.log(chalk.green(`✅ Project analysis complete. Cache saved to ${cacheFilePath}`));

        } catch (error) {
            console.error(chalk.red("\n❌ Fatal error during project analysis:"), error);
            // Consider writing a partial or error cache state? For now, just logs error.
        }
    }

    /** Phase 1: Get file list, stats, and classify */
    private async _gatherInitialInventory(timestamp: string): Promise<AnalysisCacheEntry[]> {
        const rawFileList = await this._listFiles(); // Already filtered by ignore rules
        if (!rawFileList || rawFileList.length === 0) return [];

        const inventory: AnalysisCacheEntry[] = [];

        for (const relativePath of rawFileList) {
             const inventoryEntry = await this._classifyFile(relativePath, timestamp);
             if (inventoryEntry) {
                 inventory.push(inventoryEntry);
             }
        }
        return inventory;
    }

    /** Phase 1 Helper: Gets stats and classifies a single file. */
    private async _classifyFile(relativePath: string, timestamp: string): Promise<AnalysisCacheEntry | null> {
        // No need to re-normalize if _listFiles provides clean paths
        if (!relativePath) return null;

        const absolutePath = path.resolve(this.projectRoot, relativePath);
        let fileType: AnalysisCacheEntry['type'] = 'binary'; // Default
        let size = 0;
        let loc: number | null = null;

        try {
            const stats = await this.fsUtil.stat(absolutePath);
            if (!stats) {
                 console.warn(chalk.yellow(`    Skipping inventory (stat failed): ${relativePath}`));
                 return null;
            }
            size = stats.size;

            // Explicitly skip directories that might have slipped through `find -type f` or ignore rules
            if (stats.isDirectory()) {
                console.log(chalk.grey(`    Skipping directory during classification: ${relativePath}`));
                return null; // Do not include directories in the cache
            }

            if (await this.fsUtil.isTextFile(absolutePath)) {
                // It's a text file, now check size/lines
                const content = await this.fsUtil.readFile(absolutePath);
                if (content !== null) {
                    loc = content.split('\n').length;
                    if (size > LARGE_FILE_SIZE_THRESHOLD_BYTES || loc > LARGE_FILE_LOC_THRESHOLD) {
                        fileType = 'text_large';
                        console.log(chalk.grey(`    Classified as Large Text: ${relativePath} (Size: ${(size/1024).toFixed(1)}KB, LOC: ${loc})`));
                    } else {
                        fileType = 'text_analyze';
                         console.log(chalk.dim(`    Classified for Analysis: ${relativePath} (Size: ${(size/1024).toFixed(1)}KB, LOC: ${loc})`));
                    }
                } else {
                     console.warn(chalk.yellow(`    Warning: Could not read content of text file for LOC check: ${relativePath}. Classifying as large.`));
                     fileType = 'text_large';
                     loc = null; // Can't determine LOC
                }
            } else {
                fileType = 'binary';
                 console.log(chalk.grey(`    Classified as Binary: ${relativePath} (Size: ${(size/1024).toFixed(1)}KB)`));
            }

        } catch (error) { // Catch errors during stat/read
            // Log ENOENT specifically if needed, otherwise general error
             if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                 console.warn(chalk.yellow(`    Skipping inventory (File not found during classification): ${relativePath}`));
                 return null; // Skip file if not found
             } else {
                 console.error(chalk.red(`    Error during classification for ${relativePath}:`), error);
                 // Optionally classify as binary on error, or skip completely
                 fileType = 'binary'; // Classify as binary on error
                 size = 0;
                 loc = null;
             }
        }

        // Create the entry object
        return {
            filePath: relativePath,
            type: fileType,
            size: size,
            loc: loc,
            summary: null, // Summary generated later in Phase 2
            lastAnalyzed: timestamp,
        };
    }

    /** Phase 2: Generates summaries for files marked as 'text_analyze' using BATCHING. Updates summaries in allEntries. */
    private async _runSummaryGeneration(
        filesToSummarize: AnalysisCacheEntry[],
        allEntries: AnalysisCacheEntry[] // Pass the main list to update
    ): Promise<{ analyzedCount: number; errorCount: number }> {
        let analyzedCount = 0;
        let errorCount = 0;
        const timestamp = new Date().toISOString(); // Use a consistent timestamp for this run
        const maxBatchTokens = (this.config.gemini.max_prompt_tokens || 32000) * BATCH_TOKEN_TARGET_PERCENTAGE;
        const SIZE_TO_TOKEN_RATIO = 0.3; // Rough estimate: 1 char ~= 0.3 tokens average (adjust!)
        const BASE_PROMPT_TOKEN_ESTIMATE = 200; // Estimate for the batch prompt overhead

        if (filesToSummarize.length === 0) {
             console.log(chalk.yellow("    No files suitable for AI summary generation found."));
             return { analyzedCount, errorCount };
        }

        // --- Batching Logic ---
        let currentBatchFiles: AnalysisCacheEntry[] = [];
        let currentBatchContent = "";
        let currentBatchTokenEstimate = BASE_PROMPT_TOKEN_ESTIMATE; // Start with base prompt estimate

        for (let i = 0; i < filesToSummarize.length; i++) {
            const fileInfo = filesToSummarize[i];

            // Re-check size here just before adding (though already filtered in phase 1)
            // This check is specifically for the *batching* phase, files classified 'large' won't even be in filesToSummarize
            if (fileInfo.size > MAX_FILE_SIZE_FOR_BATCH_BYTES) {
                 console.log(chalk.grey(`    Skipping file from batching phase (exceeds batch file size limit): ${fileInfo.filePath}`));
                 // Find the entry in the main list and mark it if not already marked
                 const entryIndex = allEntries.findIndex(e => e.filePath === fileInfo.filePath);
                 if (entryIndex !== -1 && allEntries[entryIndex].summary === null) {
                     allEntries[entryIndex].summary = "[Skipped in batching phase: File size too large]";
                 }
                 errorCount++; // Count this as an error/skip for summary generation
                 continue;
            }

            const estimatedFileTokens = fileInfo.size * SIZE_TO_TOKEN_RATIO; // Rough estimate for checking limit
            const fileHeader = `\n---\nFile: ${fileInfo.filePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const estimatedOverhead = countTokens(fileHeader + fileFooter); // More accurate overhead count
            const estimatedTotalCost = estimatedFileTokens + estimatedOverhead;

            // Check if adding this file exceeds the token limit for the batch
            if (currentBatchFiles.length > 0 && (currentBatchTokenEstimate + estimatedTotalCost) > maxBatchTokens) {
                // Process the current batch *before* adding the new file
                console.log(chalk.cyan(`    Batch full (${currentBatchFiles.length} files, ~${currentBatchTokenEstimate.toFixed(0)} tokens). Processing...`));
                const batchResult = await this._processBatch(currentBatchFiles, currentBatchContent, allEntries, timestamp);
                analyzedCount += batchResult.successCount;
                errorCount += batchResult.errorCount;

                // Reset for the next batch
                currentBatchFiles = [];
                currentBatchContent = "";
                currentBatchTokenEstimate = BASE_PROMPT_TOKEN_ESTIMATE;
            }

            // Add the current file to the (potentially new) batch
            // Need to read content now for the actual prompt string
            const absolutePath = path.resolve(this.projectRoot, fileInfo.filePath);
            try {
                const content = await this.fsUtil.readFile(absolutePath);
                if (content === null) {
                     console.warn(chalk.yellow(`    Warning: Could not read file ${fileInfo.filePath} when adding to batch. Skipping.`));
                     // Find the entry in the main list and mark it
                     const entryIndex = allEntries.findIndex(e => e.filePath === fileInfo.filePath);
                     if (entryIndex !== -1 && allEntries[entryIndex].summary === null) {
                         allEntries[entryIndex].summary = "[Skipped in batching phase: Read error]";
                     }
                     errorCount++;
                     continue;
                }
                const fileBlock = fileHeader + content + fileFooter;
                const actualFileBlockTokens = countTokens(fileBlock); // Use actual token count now

                // Final check with actual tokens before adding
                if (currentBatchFiles.length > 0 && (currentBatchTokenEstimate + actualFileBlockTokens) > maxBatchTokens) {
                     // Process the previous batch first if adding this specific file overflows
                     console.log(chalk.cyan(`    Batch full just before adding ${fileInfo.filePath} (${currentBatchFiles.length} files, ~${currentBatchTokenEstimate.toFixed(0)} tokens). Processing...`));
                     const batchResult = await this._processBatch(currentBatchFiles, currentBatchContent, allEntries, timestamp);
                     analyzedCount += batchResult.successCount;
                     errorCount += batchResult.errorCount;
                     // Reset for the new batch starting with the current file
                     currentBatchFiles = [];
                     currentBatchContent = "";
                     currentBatchTokenEstimate = BASE_PROMPT_TOKEN_ESTIMATE;
                }

                // Check if *this single file* exceeds the limit (after potentially processing a previous batch)
                if (BASE_PROMPT_TOKEN_ESTIMATE + actualFileBlockTokens > maxBatchTokens) {
                    console.warn(chalk.yellow(`    Skipping file from batching phase (single file exceeds token limit): ${fileInfo.filePath}`));
                    const entryIndex = allEntries.findIndex(e => e.filePath === fileInfo.filePath);
                     if (entryIndex !== -1 && allEntries[entryIndex].summary === null) {
                         allEntries[entryIndex].summary = "[Skipped in batching phase: Single file too large for batch tokens]";
                     }
                    errorCount++;
                    continue; // Skip this file entirely from batching
                }


                currentBatchFiles.push(fileInfo);
                currentBatchContent += fileBlock;
                currentBatchTokenEstimate += actualFileBlockTokens; // Update estimate accurately
                console.log(chalk.dim(`      Added to batch: ${fileInfo.filePath} (${actualFileBlockTokens} tokens). Batch total estimate: ${currentBatchTokenEstimate.toFixed(0)}`));

            } catch (readError) {
                 console.warn(chalk.yellow(`    Warning: Error reading file ${fileInfo.filePath} for batching. Skipping. Error: ${(readError as Error).message}`));
                 // Find the entry in the main list and mark it
                 const entryIndex = allEntries.findIndex(e => e.filePath === fileInfo.filePath);
                 if (entryIndex !== -1 && allEntries[entryIndex].summary === null) {
                     allEntries[entryIndex].summary = "[Skipped in batching phase: Read error]";
                 }
                 errorCount++;
            }
        } // End for loop iterating through filesToSummarize

        // Process the final batch if it has files
        if (currentBatchFiles.length > 0) {
            console.log(chalk.cyan(`    Processing final batch (${currentBatchFiles.length} files, ~${currentBatchTokenEstimate.toFixed(0)} tokens)...`));
            const batchResult = await this._processBatch(currentBatchFiles, currentBatchContent, allEntries, timestamp);
            analyzedCount += batchResult.successCount;
            errorCount += batchResult.errorCount;
        }
        // --- End Batching Logic ---

        return { analyzedCount, errorCount };
    }

    /** Processes a single batch of files by calling the AI and parsing the response. Updates summaries in allEntries. */
    private async _processBatch(
        batchFiles: AnalysisCacheEntry[], // Use the full entry now
        batchContent: string,
        allEntries: AnalysisCacheEntry[], // Main list to update
        timestamp: string
    ): Promise<{ successCount: number, errorCount: number }> {
        let successCount = 0;
        let batchErrorCount = 0;
        const filePathsInBatch = batchFiles.map(f => f.filePath);

        try {
            const prompt = AnalysisPrompts.batchSummarizePrompt(batchContent, filePathsInBatch);
            const responseJsonString = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: prompt }],
                true // USE FLASH MODEL for batches
            );

            // Parse the JSON response
            const parsedSummaries = this._parseBatchResponse(responseJsonString, filePathsInBatch);

            // Update summaries in the main allEntries list
            for (const fileInfo of batchFiles) {
                const summary = parsedSummaries[fileInfo.filePath]; // Get summary from parsed response
                const entryIndex = allEntries.findIndex(e => e.filePath === fileInfo.filePath);

                if (entryIndex === -1) {
                     console.error(chalk.red(`      INTERNAL ERROR: Could not find entry for ${fileInfo.filePath} in allEntries list during batch update!`));
                     batchErrorCount++;
                     continue;
                }

                if (summary) {
                     allEntries[entryIndex].summary = summary;
                     allEntries[entryIndex].lastAnalyzed = timestamp; // Update timestamp on successful summary
                     successCount++;
                } else {
                     // AI missed summary or parsing failed for this file
                     console.warn(chalk.yellow(`      Warning: AI response missing or failed parsing summary for ${fileInfo.filePath}`));
                     allEntries[entryIndex].summary = allEntries[entryIndex].summary || "[Summary not generated by AI]"; // Keep existing error or set new one
                     batchErrorCount++;
                }
            }
        } catch (batchProcessingError) {
            console.error(chalk.red(`    Error processing batch: ${(batchProcessingError as Error).message}`));
            batchErrorCount = batchFiles.length; // Mark all files in batch as failed
            // Update all entries in this batch within allEntries to show batch error
            for (const fileInfo of batchFiles) {
                const entryIndex = allEntries.findIndex(e => e.filePath === fileInfo.filePath);
                if (entryIndex !== -1) {
                     allEntries[entryIndex].summary = "[Batch Processing Error]";
                }
            }
        }

        return { successCount, errorCount: batchErrorCount };
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
             // Handle optional markdown code fences ```json ... ``` or ``` ... ```
             const jsonMatch = cleanJsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
             if (jsonMatch && jsonMatch[1]) {
                 cleanJsonText = jsonMatch[1].trim();
             } else if (!cleanJsonText.startsWith('{') || !cleanJsonText.endsWith('}')) {
                  // If not fenced and not starting/ending with {}, assume it's not valid JSON object as requested
                  throw new Error("Response does not appear to be a JSON object and is not wrapped in markdown fences.");
             }

             const parsed = JSON.parse(cleanJsonText);

             if (typeof parsed !== 'object' || parsed === null || typeof parsed.summaries !== 'object' || parsed.summaries === null) {
                 throw new Error("Parsed response missing 'summaries' object key or 'summaries' is not an object.");
             }

             // Populate summaries from the parsed response
             for (const filePath in parsed.summaries) {
                 if (summaries.hasOwnProperty(filePath)) { // Check if the key is one we asked for AND initialized
                     if (typeof parsed.summaries[filePath] === 'string') {
                         summaries[filePath] = parsed.summaries[filePath];
                     } else {
                         console.warn(chalk.yellow(`      Warning: Invalid summary type for ${filePath} in AI response (expected string). Setting null.`));
                         // Keep it null
                     }
                 } else {
                      console.warn(chalk.yellow(`      Warning: AI returned summary for unexpected file path ignored: ${filePath}`));
                 }
             }
             return summaries;

        } catch (e) {
            console.error(chalk.red(`      Failed to parse batch analysis JSON response. Raw text: <<<${rawJsonText}>>>`), e);
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
            // Using a simple shell check that works on Linux/macOS/Git Bash
            await this.commandService.run('command -v phind >/dev/null 2>&1', { cwd: this.projectRoot, shell: true });
            commandName = 'phind';
            // Use options to exclude ignored files and limit output like 'find'
            // phind options: -0 null terminate, --no-config, --no-ignore (we apply ignore later), -tf list only files
            // Let's try without --no-ignore first to see if it respects .gitignore well enough
            commandToRun = 'phind --no-config -tf .';
            console.log(chalk.dim(`    Found 'phind' command. Using it to list files.`));
        } catch (error) {
            // Assuming error means 'phind' is not found or check failed
            commandName = 'find';
            commandToRun = 'find . -type f'; // Stick to -type f to help exclude directories
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

        // --- Filter using .gitignore and .kaiignore (handled by GitService/FileSystem) ---
        console.log(chalk.dim(`    Filtering ${rawFileList.length} raw files using ignore rules...`));
        const ignoreRules = await this.gitService.getCombinedIgnoreRules(this.projectRoot); // Use combined rules

        const filteredList = rawFileList.filter(rawPath => {
            // Normalize path for consistency (remove leading ./, use POSIX separators)
            const normalizedPath = path.normalize(rawPath).replace(/^[./\\]+/, '').replace(/\\/g, '/');
            // Ensure the path is not empty after normalization and is not ignored
            return normalizedPath && !ignoreRules.ignores(normalizedPath);
        });

        console.log(chalk.dim(`    Filtered list size: ${filteredList.length}`));
        return filteredList.map(p => p.replace(/^[./\\]+/, '').replace(/\\/g, '/')); // Return clean relative paths
        // --- End Filter ---
    }

}