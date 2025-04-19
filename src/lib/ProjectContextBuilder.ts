// src/lib/ProjectContextBuilder.ts
// @ts-ignore
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { Config } from './Config';
import { countTokens } from './utils'; // Import from utils

export class ProjectContextBuilder {
    private fs: FileSystem;
    private projectRoot: string;
    private config: Config; // Keep config in case other settings are needed in the future

    constructor(fileSystem: FileSystem, projectRoot: string, config: Config) {
        this.fs = fileSystem;
        this.projectRoot = projectRoot;
        this.config = config; // Store config
    }

    /**
     * Reads project files, applies ignores, optimizes content, and builds the context string.
     * Includes ALL detected text files without enforcing token limits.
     * @returns An object containing the context string and its total token count.
     */
    async build(): Promise<{ context: string; tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context (including all text files)...'));
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
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

            // --- MODIFICATION START ---
            // Calculate token count for the individual file's content
            const fileTokenCount = countTokens(content);
            // --- MODIFICATION END ---

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;
            // No token check here - just append the file block
            contextString += fileBlock;
            includedFiles++;

            // --- MODIFICATION START ---
            // Update the log message to include the file's token count
            console.log(chalk.dim(`  Included ${relativePath} (${fileTokenCount} tokens)`));
            // --- MODIFICATION END ---
        }

        // Calculate the final token count of the full context
        const finalTokenCount = countTokens(contextString);

        console.log(chalk.blue(`Context built with ${includedFiles} files. ${excludedFiles} files excluded/skipped.`));
        console.log(chalk.blue(`Final calculated context token count: ${finalTokenCount}`));
        // Note: The 'max_prompt_tokens' setting in config.yaml is no longer used to limit context size here.
        // The full context will be sent, and potential truncation will happen at the API level if it exceeds the model's limit.

        return { context: contextString, tokenCount: finalTokenCount };
    }

    /**
     * Optimizes whitespace in a code string.
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