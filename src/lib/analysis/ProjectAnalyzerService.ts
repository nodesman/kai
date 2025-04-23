// src/lib/analysis/ProjectAnalyzerService.ts
import path from 'path';
import chalk from 'chalk';
import { Config } from '../Config';
import { FileSystem } from '../FileSystem';
import { CommandService } from '../CommandService';
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
     * Runs the simple, single-pass project analysis process (Milestone 1).
     */
    async analyzeProject(): Promise<void> {
        console.log(chalk.cyan("\n🚀 Starting project analysis (Milestone 1)..."));
        const cacheFilePath = path.resolve(this.projectRoot, this.config.analysis.cache_file_path);
        const analysisCache: ProjectAnalysisCache = []; // Simple array for M1

        try {
            // 1. Get file list
            const fileList = await this._listFiles();
            if (!fileList || fileList.length === 0) {
                console.log(chalk.yellow("  No files found to analyze. Skipping cache generation."));
                // Write an empty cache? Or just skip? Skipping for now.
                // await this.fsUtil.writeAnalysisCache(cacheFilePath, []);
                return;
            }
            console.log(chalk.blue(`  Found ${fileList.length} files via '${this.config.analysis.phind_command}'. Analyzing suitable text files...`));

            // 2. Analyze each suitable file iteratively
            let analyzedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            const timestamp = new Date().toISOString();

            for (const relativePathRaw of fileList) {
                const relativePath = path.normalize(relativePathRaw).replace(/^[./\\]+/, '');
                if (!relativePath) continue;

                const absolutePath = path.resolve(this.projectRoot, relativePath);

                try {
                    // Basic check: is it a text file and not too large?
                    if (!(await this.fsUtil.isTextFile(absolutePath))) {
                        console.log(chalk.grey(`    Skipping binary file: ${relativePath}`));
                        skippedCount++;
                        continue;
                    }

                    // Check size (optional for M1, but good practice)
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
                         console.warn(chalk.yellow(`    Skipping file not found: ${relativePath}`));
                    } else {
                         console.error(chalk.red(`    Error processing file ${relativePath}:`), fileError);
                         errorCount++;
                    }
                    skippedCount++;
                }
            } // End for loop

            console.log(chalk.blue(`\nAnalysis loop finished. Analyzed: ${analyzedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`));

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