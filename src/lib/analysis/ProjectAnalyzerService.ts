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

            // === Phase 2: Simple Summary Generation (for 'text_analyze' files) ===
            console.log(chalk.blue("\n  Phase 2: Generating summaries for suitable files..."));
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

    /** Phase 2: Generates summaries for files marked as 'text_analyze'. */
    private async _runSummaryGeneration(
        filesToSummarize: AnalysisCacheEntry[],
        allEntries: AnalysisCacheEntry[] // Pass the main list to update
    ): Promise<{ analyzedCount: number; errorCount: number }> {
        let analyzedCount = 0;
        let errorCount = 0;

        if (filesToSummarize.length === 0) {
             console.log(chalk.yellow("    No files suitable for AI summary generation found."));
             return { analyzedCount, errorCount };
        }

        // Using simple iteration for M2, batching can be re-introduced later if needed
        for (const entryToSummarize of filesToSummarize) {
            const absolutePath = path.resolve(this.projectRoot, entryToSummarize.filePath);
            console.log(chalk.dim(`    Summarizing: ${entryToSummarize.filePath}...`));

            try {
                // Content should be readable as it passed Phase 1 classification
                const content = await this.fsUtil.readFile(absolutePath);
                if (content === null) { // Defensive check
                     console.warn(chalk.yellow(`      Warning: Could not read content for ${entryToSummarize.filePath} during summary phase. Skipping summary.`));
                     errorCount++;
                     continue;
                }

                // Get summary using Flash model
                const summaryPrompt = AnalysisPrompts.summarizeFilePrompt(entryToSummarize.filePath, content);
                let summary = "[Summary Error]"; // Default on error

                try {
                        summary = await this.aiClient.getResponseTextFromAI(
                            [{ role: 'user', content: summaryPrompt }],
                            true // USE FLASH MODEL
                        );

                        // --- Find the entry in allEntries and update its summary ---
                        const entryIndex = allEntries.findIndex(e => e.filePath === entryToSummarize.filePath);
                         if (entryIndex !== -1) {
                             allEntries[entryIndex].summary = summary; // Update the main list
                             analyzedCount++;
                         } else {
                             // This should not happen if logic is correct
                             console.error(chalk.red(`      INTERNAL ERROR: Could not find entry for ${entryToSummarize.filePath} in allEntries list!`));
                         }
                        // --- End update ---

                } catch (aiError) {
                    console.error(chalk.red(`      AI summary failed for ${entryToSummarize.filePath}:`), aiError);
                    errorCount++;
                        // Find entry and mark summary as error
                        const entryIndex = allEntries.findIndex(e => e.filePath === entryToSummarize.filePath);
                         if (entryIndex !== -1) allEntries[entryIndex].summary = summary; // Update with error marker
                        continue;
                    }

            } catch (readError) {
                console.error(chalk.red(`      Error reading file content for summary ${entryToSummarize.filePath}:`), readError);
                errorCount++;
                // Mark summary as error in the main list
                const entryIndex = allEntries.findIndex(e => e.filePath === entryToSummarize.filePath);
                if (entryIndex !== -1) {
                    allEntries[entryIndex].summary = "[Content Read Error]";
                }
            } // End for loop
        }

        return { analyzedCount, errorCount };
    }


    // REMOVED: _processBatch and _parseBatchResponse methods (not used in M2 simple summary)

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