// src/lib/CodeProcessor.ts

import path from 'path';
import { FileSystem } from '../FileSystem';
import { AIClient } from '../AIClient';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { Config } from "../Config";
import { DiffFile } from '../types';
import { Conversation } from '../models/Conversation';
import { ConversationManager } from '../ConversationManager';
import RelevantFileFinder from "./RelevantFileFinder";
import PromptBuilder from "./PromptBuilder";

interface AIResponse {
    message: string;
    diffFiles: DiffFile[] | null;
    explanation: string;
}

class CodeProcessor {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;
    private currentDiff: DiffFile[] | null = null;
    private conversationManager: ConversationManager;

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);
        this.projectRoot = process.cwd();
        this.conversationManager = new ConversationManager();
    }

    public async askQuestion(userPrompt: string, conversation: Conversation): Promise<AIResponse> {
        conversation.addMessage('user', userPrompt);
        const promptString = await this.buildPromptString(userPrompt, conversation);
        const aiResponseString = await this.aiClient.getResponseFromAI(conversation);
        conversation.addMessage('assistant', aiResponseString);

        return this.processAIResponse(aiResponseString);
    }

    private async buildPromptString(userPrompt: string, conversation: Conversation): Promise<string> {
        const keywords = this.extractKeywords(userPrompt);
        const relevantFilePaths = await this.findRelevantFiles(keywords);
        const fileContents = await this.fs.readFileContents(relevantFilePaths);

        // Filter out null values:
        const filteredFileContents: { [filePath: string]: string } = {};
        for (const filePath in fileContents) {
            if (fileContents[filePath] !== null) {
                filteredFileContents[filePath] = fileContents[filePath]!; // Use non-null assertion (!)
            }
        }

        const promptBuilder = new PromptBuilder(this.config.gemini.max_prompt_tokens!);
        promptBuilder.addFiles(filteredFileContents, this.projectRoot); // Pass the filtered object
        promptBuilder.addConversationHistory(conversation);
        promptBuilder.addUserPrompt(userPrompt);

        return promptBuilder.build();
    }
    private async findRelevantFiles(keywords: string[]): Promise<string[]> {
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const relevantFiles = new RelevantFileFinder(this.fs).findRelevantFiles(filePaths, keywords)
        return relevantFiles;
    }

    private extractKeywords(prompt: string): string[] {
        const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'is', 'are', 'of', 'and', 'it', 'this', 'that', "i", "my", "you", "your"]);
        const words = prompt.toLowerCase().split(/\s+/);
        return [...new Set(words.filter(word => !stopWords.has(word) && word.length > 2))];
    }


    private processAIResponse(aiResponseString: string): AIResponse {
        const diffFiles = this.extractDiffs(aiResponseString);
        const explanation = this.extractExplanation(aiResponseString);
        const message = this.extractMessage(aiResponseString, explanation, diffFiles);
        return { message: message.trim(), diffFiles, explanation };
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

        if (explanation) {
            const explanationRegex = new RegExp(`\\*\\*Explanation of Changes and Key Points\\*\\*[\\s\\S]*?(?:File:|${escapeRegExp(message.slice(-10))}|$ )`);
            message = message.replace(explanationRegex, '').trim();
        }

        if (diffFiles) {
            diffFiles.forEach(diffFile => {
                const diffBlockRegex = new RegExp(`File:\\s*${escapeRegExp(diffFile.path)}\\s*\`\`\`diff\\n[\\s\\S]*?\`\`\``, 'g');
                message = message.replace(diffBlockRegex, '').trim();
            });
        }

        return message.trim();
    }
    public setCurrentDiff(diff: DiffFile[]): void {
        this.currentDiff = diff;
    }

    public async applyDiff(): Promise<void> {
        if (!this.currentDiff) {
            throw new Error("No diff to apply.");
        }

        for (const diffFile of this.currentDiff) {
            await this.fs.applyDiffToFile(diffFile.path, diffFile.content);
        }
    }

    public async checkResponse(prompt: string): Promise<string> {
        let conversation = this.conversationManager.createConversation();
        conversation.conversation.addMessage("user", prompt)
        const aiResponse = await this.aiClient.getResponseFromAI(conversation.conversation);
        return aiResponse;
    }
}

// Helper function (remains the same)
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// --- Helper Classes ---




export { CodeProcessor };