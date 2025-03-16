// lib/CodeProcessor.js
import path from 'path';
import { FileSystem } from './FileSystem.js';
import { AIClient } from './AIClient.js';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { execSync, spawn } from 'child_process';
import inquirer from 'inquirer';

class CodeProcessor {
    constructor(config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(this.config);
        this.projectRoot = process.cwd(); // Use the CURRENT WORKING DIRECTORY
        // No srcDir needed anymore!
    }

    countTokens(text) {
        return gpt3Encode(text).length;
    }

    async buildPreloadPrompt(userPrompt) {
        const keywords = this.extractKeywords(userPrompt);
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const relevantFilePaths = await this.findRelevantFiles(filePaths, keywords);
        const fileContents = await this.fs.readFileContents(relevantFilePaths);

        const messages = [];
        let currentChunk = "";
        let currentChunkTokens = 0;

        for (const filePath of relevantFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];  // Get the content
            if (!content) continue;

            // --- Whitespace Optimization ---
            content = this.optimizeWhitespace(content); // Apply optimization

            const fileHeader = `File: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileContent = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileContent);

            if (currentChunkTokens + fileTokens > this.config.get('gemini').max_context_length) {
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


    optimizeWhitespace(code) {
        // 1. Remove trailing whitespace from each line:
        code = code.replace(/[ \t]+$/gm, '');

        // 2. Reduce multiple blank lines to a single blank line:
        code = code.replace(/\n\s*\n/g, '\n\n');

        // 3. Trim leading/trailing whitespace from the entire string:
        code = code.trim();

        return code;
    }

    extractKeywords(prompt) {
        const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'is', 'are', 'of', 'and', 'it', 'this', 'that', "i", "my", "you", "your"]); // Add common pronouns
        const words = prompt.toLowerCase().split(/\s+/);
        const keywords = words.filter(word => !stopWords.has(word) && word.length > 2); // Include slightly shorter words
        return [...new Set(keywords)]; // Remove duplicates
    }

    async findRelevantFiles(filePaths, keywords) {
        const relevantFiles = [];
        for (const filePath of filePaths) {
            const content = await this.fs.readFile(filePath, 'utf-8');
            if (!content) continue;
            // Use a more robust check for keywords
            const fileContentLower = content.toLowerCase();
            if (keywords.some(keyword => fileContentLower.includes(keyword))) {
                relevantFiles.push(filePath);
            }
        }
        return relevantFiles;
    }


    async askQuestion(userPrompt) {
        const preloadMessages = await this.buildPreloadPrompt(userPrompt);
        const questionMessage = { role: "user", parts: [{ text: userPrompt }] };
        const finalMessages = [...preloadMessages, questionMessage];

        const response = await this.aiClient.getResponseFromAI(finalMessages);
        console.log(response);
    }
}

export { CodeProcessor };