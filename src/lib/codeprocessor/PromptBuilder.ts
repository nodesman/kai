import path from "path";
import Conversation from "../models/Conversation";
import gpt3Encode from "gpt-3-encoder"
class PromptBuilder {
    private promptString: string = "";
    private currentTokenCount: number = 0;
    private maxPromptTokens: number;
    private basePrompt: string = `You are a coding assistant...`; // The full base prompt

    constructor(maxPromptTokens: number) {
        this.maxPromptTokens = maxPromptTokens;
        this.promptString = this.basePrompt; //initialize
    }

    public addFiles(fileContents: { [filePath: string]: string }, projectRoot: string): void {
        const sortedFilePaths = Object.keys(fileContents).sort();

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) continue;

            content = this.optimizeWhitespace(content);

            const fileHeader = `File: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileContent = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileContent);

            if (this.currentTokenCount + fileTokens > this.maxPromptTokens) {
                break;
            }

            this.promptString += fileContent;
            this.currentTokenCount += fileTokens;
        }
    }
    private optimizeWhitespace(code: string): string {
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\n\s*\n/g, '\n\n');
        code = code.trim();
        return code;
    }

    public addConversationHistory(conversation: Conversation): void {
        let conversationHistory = "";
        for (const message of conversation.getMessages()) {
            conversationHistory += `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}\n`;
        }
        this.promptString += `\n\n${conversationHistory}`;
    }

    public addUserPrompt(userPrompt: string): void {
        this.promptString += `\nUser: ${userPrompt}\n\nAssistant:`;
    }

    public build(): string {
        return this.promptString;
    }
    private countTokens(text: string): number {
        return gpt3Encode.encode(text).length;
    }
}

export default PromptBuilder;