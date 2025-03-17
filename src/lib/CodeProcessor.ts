// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient } from './AIClient';
import { encode as gpt3Encode } from 'gpt-3-encoder';
// import { execSync, spawn } from 'child_process'; // Not used, can be removed
// import inquirer from 'inquirer'; // Not used in this file, remove.
// import Models from "./models/modelsEnum"; // Not used, remove
import {Config} from "./Config"; // Import Config

class CodeProcessor {
    config: Config;     // Property declaration WITH TYPE
    fs: FileSystem;     // Property declaration WITH TYPE
    aiClient: AIClient; // Property declaration WITH TYPE
    projectRoot: string; // Property declaration WITH TYPE


    constructor(config: Config) { // Type annotation
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config); // Removed Models.Gemini2Pro - AIClient now handles this
        this.projectRoot = process.cwd(); // Use the CURRENT WORKING DIRECTORY
        // No srcDir needed anymore!
    }

    countTokens(text: string): number { // Type annotation and return type
        return gpt3Encode(text).length;
    }

    async buildPreloadPrompt(userPrompt: string): Promise<any[]> { // Type annotations, and return type (any[] for now)
        const keywords = this.extractKeywords(userPrompt);
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const relevantFilePaths = await this.findRelevantFiles(filePaths, keywords);
        const fileContents = await this.fs.readFileContents(relevantFilePaths);

        const messages: any[] = []; // Type annotation (any[] for now - you'll refine this)
        let currentChunk = "";
        let currentChunkTokens = 0;

        for (const filePath of Object.keys(fileContents)) { // Iterate over keys, not the array itself
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];  // Get the content
            if (!content) continue;

            // --- Whitespace Optimization ---
            content = this.optimizeWhitespace(content); // Apply optimization

            const fileHeader = `File: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileContent = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileContent);

            if (currentChunkTokens + fileTokens > this.config.gemini.max_retries!) {
                messages.push({ role: "user", parts: [{ text: currentChunk }] });
                messages.push({ role: "model", parts: [{ text: "Sure, I've loaded that code." }] });
                currentChunk = "";
                currentChunkTokens = 0;
            }

            currentChunk += fileContent;
            currentChunkTokens += fileTokens;
        }

        if (currentChunk) {
            messages.push({ role: "user", parts: [{ text: currentChunk }] });
            messages.push({ role: "model", parts: [{ text: "Okay, I've loaded the remaining files." }] });
        }
        return messages;
    }


    optimizeWhitespace(code: string): string { // Type annotation and return type
        // 1. Remove trailing whitespace from each line:
        code = code.replace(/[ \t]+$/gm, '');

        // 2. Reduce multiple blank lines to a single blank line:
        code = code.replace(/\n\s*\n/g, '\n\n');

        // 3. Trim leading/trailing whitespace from the entire string:
        code = code.trim();

        return code;
    }

    extractKeywords(prompt: string): string[] { // Type annotation
        const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'is', 'are', 'of', 'and', 'it', 'this', 'that', "i", "my", "you", "your"]); // Add common pronouns
        const words = prompt.toLowerCase().split(/\s+/);
        const keywords = words.filter(word => !stopWords.has(word) && word.length > 2); // Include slightly shorter words
        return [...new Set(keywords)]; // Remove duplicates
    }

    async findRelevantFiles(filePaths: string[], keywords: string[]): Promise<string[]> { // Type annotations
        const relevantFiles: string[] = []; // Provide explicit type
        for (const filePath of filePaths) {
            const fileContent = await this.fs.readFile(filePath); // Removed encoding - not always needed.  Let fs.readFile use default.
            if (!fileContent) continue;

            // Use a more robust check for keywords
            const fileContentLower = fileContent.toLowerCase();
            if (keywords.some(keyword => fileContentLower.includes(keyword))) {
                relevantFiles.push(filePath);
            }
        }
        return relevantFiles;
    }


    async askQuestion(userPrompt: string): Promise<string> { // Type annotation
        //Simplified the below code, no need to make it an array of objects.
        const preloadedPrompt = await this.buildPreloadPrompt(userPrompt);
        const response = await this.aiClient.getResponseFromAI(preloadedPrompt + userPrompt);
        console.log(response);
        return response
    }
}

export { CodeProcessor };