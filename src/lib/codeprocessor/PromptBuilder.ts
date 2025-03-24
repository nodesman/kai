//File: src/lib/codeprocessor/PromptBuilder.ts

import path from "path";
import Conversation from "../models/Conversation";
import { encode as gpt3Encode } from 'gpt-3-encoder';

class PromptBuilder {
    private promptString: string = "";
    private currentTokenCount: number = 0;
    private maxPromptTokens: number;
    private readonly filePrefix: string = "### File Context ###\n"; // Prefix

    constructor(maxPromptTokens: number) {
        this.maxPromptTokens = maxPromptTokens;
    }

    //Creates prompt for File Contents, does NOT add it internally.
    public buildFilesPrompt(fileContents: { [filePath: string]: string }, projectRoot: string): string {
        let fileContextString = "";
        const sortedFilePaths = Object.keys(fileContents).sort();

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) continue; // Skip if content is null/undefined

            content = this.optimizeWhitespace(content);

            const fileHeader = `File: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileContent = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileContent);

            if (this.currentTokenCount + fileTokens > this.maxPromptTokens) {
                break; // Stop adding files if we exceed the token limit
            }

            fileContextString += fileContent;
            this.currentTokenCount += fileTokens;
        }
        return fileContextString;
    }
    //Do not use. Use buildFilesPrompt instead.
    public addFiles(fileContents: { [filePath: string]: string }, projectRoot: string): void {
        const fileContextString = this.buildFilesPrompt(fileContents, projectRoot);
        this.promptString += fileContextString;

    }

    private optimizeWhitespace(code: string): string {
        code = code.replace(/[ \t]+$/gm, ''); // Remove trailing spaces/tabs
        code = code.replace(/\n\s*\n/g, '\n\n');  // Remove empty lines
        code = code.trim();
        return code;
    }


    public addConversationHistory(conversation: Conversation): void {
        for (const message of conversation.getMessages()) {
            if (message.content.startsWith(this.filePrefix)) {
                continue; // Skip the file context message
            }
            this.promptString += `${message.role === 'user' ? 'User' : message.role === 'system' ? 'System' : 'Assistant'}: ${message.content}\n`;
        }
    }

    public addUserPrompt(userPrompt: string): void {
        //No longer needed.
        // this.promptString += `\nUser: ${userPrompt}\n\nAssistant:`;
    }

    public build(): string {

        return this.promptString;
    }
    private countTokens(text: string): number {
        return gpt3Encode(text).length;
    }
}

export default PromptBuilder;