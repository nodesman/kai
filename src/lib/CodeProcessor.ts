// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient } from './AIClient';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { Config } from "./Config";
import { Conversation, Message } from './models/Conversation';

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    projectRoot: string;

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);
        this.projectRoot = process.cwd();
    }

    countTokens(text: string): number {
        return gpt3Encode(text).length;
    }

    async buildPromptString(userPrompt: string): Promise<string> { // Returns a string
        const keywords = this.extractKeywords(userPrompt);
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const relevantFilePaths = await this.findRelevantFiles(filePaths, keywords);
        const fileContents = await this.fs.readFileContents(relevantFilePaths);

        let promptString = "";
        let currentTokenCount = 0;

        // Sort files by name for consistent prompt construction
        const sortedFilePaths = Object.keys(fileContents).sort();

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) continue;

            content = this.optimizeWhitespace(content);

            const fileHeader = `File: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileContent = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileContent);

            // Check *before* adding the file content
            if (currentTokenCount + fileTokens > this.config.gemini.max_prompt_tokens!) { // Use max_prompt_tokens
                break; // Stop adding files if we exceed the limit
            }

            promptString += fileContent;
            currentTokenCount += fileTokens;
        }

        promptString += `\n\nUser: ${userPrompt}\n\nAssistant:`; // Add user prompt directly
        return promptString;
    }
    optimizeWhitespace(code: string): string {
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\n\s*\n/g, '\n\n');
        code = code.trim();
        return code;
    }

    extractKeywords(prompt: string): string[] {
        const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'is', 'are', 'of', 'and', 'it', 'this', 'that', "i", "my", "you", "your"]);
        const words = prompt.toLowerCase().split(/\s+/);
        const keywords = words.filter(word => !stopWords.has(word) && word.length > 2);
        return [...new Set(keywords)];
    }

    async findRelevantFiles(filePaths: string[], keywords: string[]): Promise<string[]> {
        const relevantFiles: Set<string> = new Set(); //Use a set to avoid duplicates
        for (const filePath of filePaths) {
            const fileContent = await this.fs.readFile(filePath);
            if (!fileContent) continue;

            const fileContentLower = fileContent.toLowerCase();
            if (keywords.some(keyword => fileContentLower.includes(keyword))) {
                relevantFiles.add(filePath);
            }
        }
        return Array.from(relevantFiles); //Convert back to array
    }

    async askQuestion(userPrompt: string): Promise<string> {
        const promptString = await this.buildPromptString(userPrompt); // Get the complete prompt string
        const response = await this.aiClient.getResponseFromAI(promptString); // Pass the STRING
        return response;
    }
}

export { CodeProcessor };