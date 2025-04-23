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
const MAX_FILE_SIZE_FOR_SUMMARY_BYTES = 200 * 1024; // 200 KB limit per file for analysis

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
     * Runs the simple, single-pass project analysis process (Milestone 1).
     */
    async analyzeProject(): Promise<void> {
        console.log(chalk.cyan("\n🚀 Starting project analysis (Milestone 1)..."));
        const cacheFilePath = path.resolve(this.projectRoot, this.config.analysis.cache_file_path);
        const analysisCache: ProjectAnalysisCache = []; // Simple array for M1

        try {
            // 1. Get file list (filtered by ignore rules)
            const fileList = await this._listFiles();
            if (!fileList || fileList.length === 0) {
                console.log(chalk.yellow("  No files found to analyze (after filtering). Skipping cache generation."));
                // Write an empty cache? Or just skip? Skipping for now.
                // await this.fsUtil.writeAnalysisCache(cacheFilePath, []);
                return;
            }
            console.log(chalk.blue(`  Found ${fileList.length} files for analysis (after filtering). Analyzing suitable text files...`));

            // 2. Analyze each suitable file iteratively
            let analyzedCount = 0;
            let skippedCount = 0; // Count files skipped due to size/type (after initial filtering)
            let errorCount = 0;
            const timestamp = new Date().toISOString();

            for (const relativePath of fileList) { // Iterate the filtered list
                // No need for extra normalization here, _listFiles should provide clean relative paths
                if (!relativePath) continue;

                const absolutePath = path.resolve(this.projectRoot, relativePath);

                try {
                    // Basic check: is it a text file and not too large?
                    // No need to re-check binary status if isTextFile is accurate
                    // and _listFiles already filters non-files.

                    const stats = await this.fsUtil.stat(absolutePath); // Use stat from fsUtil
                    if (!stats) {
                         console.warn(chalk.yellow(`    Skipping file (stat failed): ${relativePath}`));
                         skippedCount++;
                         continue;
                    }
                    if (stats.size > MAX_FILE_SIZE_FOR_SUMMARY_BYTES) {
                        console.log(chalk.grey(`    Skipping large file (${(stats.size / 1024).toFixed(1)} KB): ${relativePath}`));
                        skippedCount++;
                        continue;
                    }
                    if (!(await this.fsUtil.isTextFile(absolutePath))) {
                         console.log(chalk.grey(`    Skipping non-text file (missed by initial check?): ${relativePath}`));
                         skippedCount++;
                         continue;
                    }


                    const content = await this.fsUtil.readFile(absolutePath);
                    if (content === null || !content.trim()) {
                        console.log(chalk.grey(`    Skipping empty/unreadable file: ${relativePath}`));
                        skippedCount++;
                        continue;
                    }

                    console.log(chalk.dim(`    Analyzing: ${relativePath}...`));
                    const loc = content.split('\n').length;

                    // Get summary using Flash model
                    const summaryPrompt = AnalysisPrompts.summarizeFilePrompt(relativePath, content);
                    let summary = "Error generating summary."; // Default on error

                    try {
                        // Explicitly useFlashModel = true
                        summary = await this.aiClient.getResponseTextFromAI(
                            [{ role: 'user', content: summaryPrompt }],
                            true // USE FLASH MODEL
                        );
                        summary = summary.trim();
                        console.log(chalk.dim(`      Summary received (Flash Model)`));
                    } catch (aiError) {
                        console.error(chalk.red(`      AI summary failed for ${relativePath}:`), aiError);
                        errorCount++;
                        // Keep default error summary
                    }

                    analysisCache.push({
                        filePath: relativePath,
                        loc: loc,
                        summary: summary,
                        lastAnalyzed: timestamp
                    });
                    analyzedCount++;

                } catch (fileError) {
                    if ((fileError as NodeJS.ErrnoException).code === 'ENOENT') {
                         // This shouldn't happen often if _listFiles worked, but handle defensively
                         console.warn(chalk.yellow(`    Skipping file not found during analysis: ${relativePath}`));
                    } else {
                         console.error(chalk.red(`    Error processing file ${relativePath}:`), fileError);
                         errorCount++;
                    }
                    skippedCount++; // Increment skipped if any error occurs processing the file
                }
            } // End for loop

            console.log(chalk.blue(`\nAnalysis loop finished. Analyzed: ${analyzedCount}, Skipped (Size/Type/Error): ${skippedCount}, AI Errors: ${errorCount}`));

            // 3. Write the simple array cache
            if (analysisCache.length > 0 || errorCount === 0) { // Write even if empty but no errors? Decide policy. Writing if analyzed>0.
                await this.fsUtil.writeAnalysisCache(cacheFilePath, analysisCache);
                console.log(chalk.green(`✅ Project analysis complete. Cache saved to ${cacheFilePath}`));
            } else {
                 console.error(chalk.red(`❌ Project analysis finished with errors or no files analyzed. Cache NOT saved.`));
            }


        } catch (error) {
            console.error(chalk.red("\n❌ Fatal error during project analysis:"), error);
            // Consider cleanup or specific error reporting
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