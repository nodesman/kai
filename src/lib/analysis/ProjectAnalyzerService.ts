// src/lib/analysis/ProjectAnalyzerService.ts
import path from 'path';
import chalk from 'chalk';
import fs from 'fs/promises'; // Use promises fs for stats
import { Config } from '../Config';
import { FileSystem } from '../FileSystem';
import { CommandService } from '../CommandService';
import { AIClient } from '../AIClient';
import { AnalysisCacheEntry, ProjectAnalysisCache } from './types';
import { AnalysisPrompts } from './prompts'; // Use the new prompts file
import { countTokens } from '../utils'; // Needed if we add token limits later

// --- Configuration ---
const LARGE_FILE_SIZE_THRESHOLD_BYTES = 100 * 1024; // 100 KB
const LARGE_FILE_LOC_THRESHOLD = 5000; // 5000 lines

export class ProjectAnalyzerService {
    private config: Config;
    private fsUtil: FileSystem;
    private commandService: CommandService;
    private aiClient: AIClient;
    private projectRoot: string;

    constructor(
        config: Config,
        fsUtil: FileSystem,
        commandService: CommandService,
        aiClient: AIClient
    ) {
        this.config = config;
        this.fsUtil = fsUtil;
        this.commandService = commandService;
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

        try {
            // === Phase 1: Inventory and Classification ===
            console.log(chalk.blue("  Phase 1: Inventorying and classifying files..."));
            const rawFileList = await this._listFiles();
            if (!rawFileList || rawFileList.length === 0) {
                console.log(chalk.yellow("  No files found to analyze. Skipping cache generation."));
                return;
            }

            let filesToAnalyze: AnalysisCacheEntry[] = []; // Only those needing AI summary

            for (const relativePathRaw of rawFileList) {
                 const inventoryEntry = await this._classifyFile(relativePathRaw, timestamp);
                 if (inventoryEntry) {
                     allEntries.push(inventoryEntry);
                     if (inventoryEntry.type === 'text_analyze') {
                         filesToAnalyze.push(inventoryEntry);
                     }
                 }
            }
            console.log(chalk.blue(`  Inventory complete: Found ${allEntries.length} total items.`));
            console.log(chalk.blue(`           Identified ${filesToAnalyze.length} text files for AI analysis.`));
            console.log(chalk.blue(`           Identified ${allEntries.length - filesToAnalyze.length} binary/large files (will be listed).`));


            // === Phase 2: Simple Summary Generation (for 'text_analyze' files) ===
            console.log(chalk.blue("\n  Phase 2: Generating summaries for suitable files..."));
            let analyzedCount = 0;
            let errorCount = 0;

            if (filesToAnalyze.length === 0) {
                 console.log(chalk.yellow("    No files suitable for AI summary generation found."));
            } else {
                for (const entryToSummarize of filesToAnalyze) {
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
                            summary = summary.trim();
                            console.log(chalk.dim(`      Summary received (Flash Model)`));

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
                }
                } // End for loop for summaries
            } // End if filesToAnalyze > 0
            console.log(chalk.blue(`\nSummary generation finished. Summarized: ${analyzedCount}, Errors during summary: ${errorCount}`));


            // === Phase 3: Cache Assembly & Saving ===
            console.log(chalk.blue("\n  Phase 3: Assembling and saving cache..."));
            const finalCache: ProjectAnalysisCache = {
                // Set overallSummary to null or a placeholder for M2
                overallSummary: `Analysis Pass Completed: ${analyzedCount} files summarized, ${allEntries.length - filesToAnalyze.length} binary/large files listed.`,
                entries: allEntries.sort((a, b) => a.filePath.localeCompare(b.filePath)) // Sort entries by path
            };

            await this.fsUtil.writeAnalysisCache(cacheFilePath, finalCache);
            console.log(chalk.green(`✅ Project analysis complete. Cache saved to ${cacheFilePath}`));


        } catch (error) {
            console.error(chalk.red("\n❌ Fatal error during project analysis:"), error);
            // Consider cleanup or specific error reporting
        }
    }

    /** Phase 1 Helper: Gets stats and classifies a single file. */
    private async _classifyFile(relativePathRaw: string, timestamp: string): Promise<AnalysisCacheEntry | null> {
        const relativePath = path.normalize(relativePathRaw).replace(/^[./\\]+/, '');
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
             console.error(chalk.red(`    Error during classification for ${relativePath}:`), error);
             // Optionally decide how to classify on error, defaulting to 'binary' might be safest
             fileType = 'binary';
             size = 0;
             loc = null;
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

    /** Runs the `phind` command */
    private async _listFiles(): Promise<string[]> {
        // Default to 'find . -type f' if command not set in config
        const command = this.config.analysis?.phind_command || "find . -type f";
        try {
            console.log(chalk.dim(`    Executing file list command: ${command}`));
            const { stdout } = await this.commandService.run(command, { cwd: this.projectRoot });
            return stdout.trim().split('\n').filter(line => line.trim() !== '');
        } catch (error) {
            console.error(chalk.red(`Error running file listing command "${command}":`), error);
            throw new Error(`Failed to list project files using command: ${command}. Please ensure the command works and is configured correctly.`);
        }
    }
}