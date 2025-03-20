// File: src/lib/CodeProcessor.ts

import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient } from './AIClient';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { Config } from "./Config";
import { DiffFile } from './types'; // Import DiffFile
import { Conversation, Message } from './models/Conversation';

interface AIResponse {
    message: string;
    diffFiles: DiffFile[] | null;
}

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    projectRoot: string;
    currentDiff: DiffFile[] | null = null; // Store the current diff

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
        // Construct the base prompt
        let basePrompt = `You are a coding assistant.  I will give you files from my project, and you will answer my questions and comply with my change requests.
            If I request code changes, respond ONLY with a diff of the MINIMAL changes necessary. Do NOT include markdown or additional explanations unless I ask for it. Respond with ONLY the diff. If you provide a diff, it should be inside a codeblock with the word "diff". The file to modify should be listed before the diff code block.`;

        // Prepend the base prompt
        promptString = `${basePrompt}\n\n${promptString}\n\nUser: ${userPrompt}\n\nAssistant:`;
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

    async askQuestion(userPrompt: string): Promise<AIResponse> {
        const promptString = await this.buildPromptString(userPrompt);
        const aiResponse = await this.aiClient.getResponseFromAI(promptString);

        let message = aiResponse; // Default: entire response is the message
        let diffFiles: DiffFile[] | null = null;

        //const diffRegex = /File:\s*([^\n]+)\n*```diff([\s\S]*?)```/g;
        const diffRegex = /File:\s*([^\n`]+)\s*`{3}diff\n([\s\S]+?)`{3}/g;
        let match;

        diffFiles = [];
        let lastIndex = 0;
        while ((match = diffRegex.exec(aiResponse)) !== null) {

            const filePath = match[1].trim();
            const diffContent = match[2].trim();
            diffFiles.push({ path: filePath, content: diffContent });
            message = message.replace(match[0], '').trim();
            lastIndex = match.index + match[0].length;

        }
        if(diffFiles.length === 0)
            diffFiles = null;

        return { message, diffFiles };
    }

    setCurrentDiff(diff: DiffFile[]): void {
        this.currentDiff = diff;
    }

    async applyDiff(): Promise<void> {
        if (!this.currentDiff) {
            throw new Error("No diff to apply.");
        }

        for (const diffFile of this.currentDiff) {
            await this.fs.applyDiffToFile(diffFile.path, diffFile.content);
        }
    }
}

export { CodeProcessor };