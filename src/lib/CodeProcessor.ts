// src/lib/CodeProcessor.ts

import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient } from './AIClient';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { Config } from "./Config";
import { DiffFile } from './types'; // Import DiffFile
import { Conversation } from './models/Conversation';
// No need to import UUID, ConversationManager handles it
import { ConversationManager } from './ConversationManager'; // Import


interface AIResponse {
    message: string;
    diffFiles: DiffFile[] | null;
    explanation: string; // Add explanation field
}

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    projectRoot: string;
    currentDiff: DiffFile[] | null = null; // Store the current diff
    private conversationManager: ConversationManager; // Use ConversationManager

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);
        this.projectRoot = process.cwd();
        this.conversationManager = new ConversationManager(); // Initialize
    }

    countTokens(text: string): number {
        return gpt3Encode(text).length;
    }

    async buildPromptString(userPrompt: string, conversation: Conversation): Promise<string> { // Returns a string
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

        let conversationHistory = "";
        for (const message of conversation.getMessages()) {
            conversationHistory += `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}\n`;
        }

        // Construct the base prompt
        let basePrompt = `You are a coding assistant.  I will give you files from my project, and you will answer my questions and comply with my change requests.
            If I request code changes, provide ONLY a diff of the MINIMAL changes necessary INSIDE a code block with the word 'diff', followed by an explanation of the changes and important considerations formatted like the example that follows.
            The response MUST include the file name before the diff code block.

            **Example Response Format:**

            **Explanation of Changes and Key Points**

            *   **\`File1.ts\`**
                *   Explanation of changes to File1.ts
            *   **\`File2.ts\`**
                *   Explanation of changes to File2.ts

            **Important Considerations and Improvements**

            *   Consideration 1.
            *   Consideration 2.
            File: File1.ts
            \`\`\`diff
            ...diff content for File1.ts...
            \`\`\`
            File: File2.ts
            \`\`\`diff
            ...diff content for File2.ts...
            \`\`\``;

        promptString = `${basePrompt}\n\n${conversationHistory}\nUser: ${userPrompt}\n\nAssistant:`;
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

    async askQuestion(userPrompt: string, conversation: Conversation): Promise<AIResponse> { // Takes a Conversation object

        conversation.addMessage('user', userPrompt); // Add user message to the conversation
        const promptString = await this.buildPromptString(userPrompt, conversation);
        const aiResponseString = await this.aiClient.getResponseFromAI(conversation);

        conversation.addMessage('assistant', aiResponseString);

        let message = "";
        let diffFiles: DiffFile[] | null = null;
        let explanation = "";

        // 1. Improved Diff Extraction: Prioritize accurate diff retrieval
        diffFiles = this.extractDiffs(aiResponseString); // Dedicated method

        // 2. Extract Explanation
        explanation = this.extractExplanation(aiResponseString);

        // 3. Extract Main Message (After Diffs and Explanation are Removed)
        message = this.extractMessage(aiResponseString, explanation, diffFiles);

        message = message.trim(); // Clean up any leftover whitespace
        return { message, diffFiles, explanation };
    }

    private extractDiffs(aiResponse: string): DiffFile[] | null {
        const diffRegex = /File:\s*([^\n`]+)\s*`{3}diff\n([\s\S]+?)`{3}/g;
        const files: DiffFile[] = [];
        let match;

        while ((match = diffRegex.exec(aiResponse)) !== null) {
            const filePath = match[1].trim();
            const diffContent = match[2].trim();
            files.push({ path: filePath, content: diffContent });
        }

        return files.length > 0 ? files : null;
    }

    private extractExplanation(aiResponse: string): string {
        const explanationRegex = /\*\*Explanation of Changes and Key Points\*\*([\s\S]*?)(?:File:|$)/;
        const match = aiResponse.match(explanationRegex);
        return match ? match[1].trim() : "";
    }

    private extractMessage(aiResponse: string, explanation: string, diffFiles: DiffFile[] | null): string {
        let message = aiResponse;

        // Remove explanation if it exists
        if (explanation) {
            const explanationRegex = new RegExp(`\\*\\*Explanation of Changes and Key Points\\*\\*[\\s\\S]*?(?:File:|${escapeRegExp(message.slice(-10))}|$ )`);
            message = message.replace(explanationRegex, '').trim();
        }

        // Remove diffs if they exist
        if (diffFiles) {
            diffFiles.forEach(diffFile => {
                const diffBlockRegex = new RegExp(`File:\\s*${escapeRegExp(diffFile.path)}\\s*\`\`\`diff\\n[\\s\\S]*?\`\`\``, 'g');
                message = message.replace(diffBlockRegex, '').trim();
            });
        }

        return message.trim();
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
    async checkResponse(prompt: string): Promise<string> {
        let conversation = this.conversationManager.createConversation();
        conversation.conversation.addMessage("user", prompt)
        const aiResponse = await this.aiClient.getResponseFromAI(conversation.conversation);
        return aiResponse;
    }
}

// Helper function to escape regex special characters
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { CodeProcessor };