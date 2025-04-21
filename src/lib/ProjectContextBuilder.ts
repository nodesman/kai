// src/lib/ProjectContextBuilder.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { Config } from './Config';
import { countTokens } from './utils';
import { GitService } from './GitService'; // <-- Import GitService

export class ProjectContextBuilder {
    private fs: FileSystem;
    private projectRoot: string;
    private config: Config;
    private gitService: GitService; // <-- Add GitService instance variable

    // Update constructor to accept GitService
    constructor(
        fileSystem: FileSystem,
        gitService: GitService, // <-- Add gitService parameter
        projectRoot: string,
        config: Config
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
     */
    async build(): Promise<{ context: string; tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context (including all text files)...'));

        // --- Get ignore rules from GitService ---
        const ignoreRules = await this.gitService.getIgnoreRules(this.projectRoot);
        // --- End getting ignore rules ---

        // Pass the ignore rules object to getProjectFiles
        const filePaths = await this.fs.getProjectFiles(this.projectRoot, this.projectRoot, ignoreRules); // Pass ignoreRules
        const fileContents = await this.fs.readFileContents(filePaths);

        let contextString = "Code Base Context:\n";
        let includedFiles = 0;
        let excludedFiles = 0;
        const sortedFilePaths = Object.keys(fileContents).sort();

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) {
                console.log(chalk.gray(`  Skipping empty file: ${relativePath}`));
                excludedFiles++;
                continue;
            }
            content = this.optimizeWhitespace(content);
            if (!content) {
                console.log(chalk.gray(`  Skipping file with only whitespace: ${relativePath}`));
                excludedFiles++;
                continue;
            }

            const fileTokenCount = countTokens(content);
            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;
            contextString += fileBlock;
            includedFiles++;
            console.log(chalk.dim(`  Included ${relativePath} (${fileTokenCount} tokens)`));
        }

        const finalTokenCount = countTokens(contextString);

        console.log(chalk.blue(`Context built with ${includedFiles} files. ${excludedFiles} files excluded/skipped.`));
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