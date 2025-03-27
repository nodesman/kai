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
    private config: Config;

    constructor(fileSystem: FileSystem, projectRoot: string, config: Config) {
        this.fs = fileSystem;
        this.projectRoot = projectRoot;
        this.config = config;
    }

    /**
     * Reads project files, applies ignores, optimizes content, and builds the context string.
     * @returns An object containing the context string and its token count.
     */
    async build(): Promise<{ context: string; tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context...'));
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const fileContents = await this.fs.readFileContents(filePaths);

        let contextString = "Code Base Context:\n";
        let currentTokenCount = countTokens(contextString);
        // Use max_prompt_tokens from config, apply safety margin
        const maxContextTokens = (this.config.gemini.max_prompt_tokens || 32000) * 0.6; // 60% safety margin
        let includedFiles = 0;
        let excludedFiles = 0;
        const sortedFilePaths = Object.keys(fileContents).sort();
        let estimatedTotalTokens = currentTokenCount; // Use a separate variable for estimated total

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

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;
            const fileTokens = countTokens(fileBlock);

            contextString += fileBlock;
            estimatedTotalTokens += fileTokens; // Update estimated total
            includedFiles++;
            console.log(chalk.dim(`  Included ${relativePath} (${fileTokens} tokens). Current total: ${estimatedTotalTokens.toFixed(0)}`));
        }

        console.log(chalk.blue(`Context built with ${includedFiles} files (${estimatedTotalTokens.toFixed(0)} tokens estimated). ${excludedFiles} files excluded/skipped. Max context set to ${maxContextTokens.toFixed(0)} tokens.`));
        // Recalculate final token count just to be sure, though estimation should be close
        const finalTokenCount = countTokens(contextString);
        console.log(chalk.blue(`Final calculated context token count: ${finalTokenCount}`));

        if (finalTokenCount > (this.config.gemini.max_prompt_tokens || 32000)) {
            console.warn(chalk.yellow(`Warning: Final context token count (${finalTokenCount}) exceeds configured max_prompt_tokens (${this.config.gemini.max_prompt_tokens}). Potential truncation by API.`));
        }


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