// File: src/lib/codeprocessor/CodeProcessor.ts

import {FileSystem} from '../FileSystem';
import {AIClient} from '../AIClient';
import {Config} from "../Config";
import {DiffFile} from '../types';
import {Conversation} from '../models/Conversation';
import {ConversationManager} from '../ConversationManager';
import RelevantFileFinder from "./RelevantFileFinder";
import PromptBuilder from "./PromptBuilder";
import * as Diff from 'diff'; // Import the 'diff' library
import path from "path";

interface AIResponse {
    message: string;
    diffFiles: DiffFile[] | null;
    explanation: string;
}

class CodeProcessor {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;  // Correct: Use AIClient, not specific models
    private projectRoot: string;
    private currentDiff: DiffFile[] | null = null; //For storing the latest diff, when the user wants to apply changes.
    private conversationManager: ConversationManager;
    private readonly filePrefix: string = "### File Context ###\n"; // Prefix

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);  // Correct: Use AIClient
        this.projectRoot = process.cwd();
        this.conversationManager =  ConversationManager.getInstance();
    }

    // Main entry point for processing user requests
    public async askQuestion(userPrompt: string, conversation: Conversation): Promise<AIResponse> {
        // 1. Check if the prompt is a "diff" prompt using GPT-4o-mini via the AIClient
        const isDiffPrompt = await this.isDiffPrompt(userPrompt);

        // 2. Build the complete prompt, including file context.
        const updatedConversation = await this.buildPromptString(userPrompt, conversation);

        // 3. Get response from Gemini 2 Pro (via AIClient).
        let aiResponseString = await this.aiClient.getResponseFromAI(updatedConversation);  // No model name needed - defaults to Gemini
        updatedConversation.addMessage('assistant', aiResponseString); //add it to converation

        // 4. Process the response, check for explanation
        const aiResponse = this.processAIResponse(aiResponseString);

        // 5. If it's a diff *and* there's an embedded explanation, extract it.
        if (aiResponse.diffFiles && aiResponse.explanation) {
            //No need to do anything, the diff and explanation have been returned
        }

        // 6. If no explanation but there are diffFiles, ask for one:
        if (aiResponse.diffFiles && !aiResponse.explanation){
            const explanationPrompt = `Explain the following code changes in detail, referencing filenames: \n\`\`\`diff\n${aiResponse.message}\n\`\`\``;
            const explanationResponse = await this.aiClient.getResponseFromAI(new Conversation("", [{ role: 'user', content: explanationPrompt }]));
            aiResponse.explanation = explanationResponse;  // Add the explanation
        }

        return aiResponse;
    }

    // Helper method to check if a prompt is likely a diff request (using GPT-4o-mini)
    private async isDiffPrompt(prompt: string): Promise<boolean> {
        const checkPrompt = `Does the following user prompt request changes to existing files in the codebase, including modifications or additions to existing files? 
        The prompt may be a generic question about the code base or not at all. Or a qeustion about how things are currenlty working. Or a question about how to achieve
        something in the code base. I am looking for the case where the user is asking how to get this code to work a certain way or what a certain outcome entail in terms of
        code changes. Respond with "true" or "false".\n\n${prompt}`;
        const response = await this.aiClient.getResponseFromAI(new Conversation("", [{ role: 'user', content: checkPrompt }]), "gpt-4o");  // Use AIClient, specify model
        return response.toLowerCase().includes("true");
    }

    // Builds the prompt string, including file context and user prompt
    private async buildPromptString(userPrompt: string, conversation: Conversation): Promise<Conversation> {
        const relevantFilePaths = await this.findRelevantFiles();
        const fileContents = await this.fs.readFileContents(relevantFilePaths);

        // Filter out null values (e.g., binary files, read errors):
        const filteredFileContents: { [filePath: string]: string } = {};
        for (const filePath in fileContents) {
            if (fileContents[filePath] !== null) {
                filteredFileContents[filePath] = fileContents[filePath]!; // Use non-null assertion
            }
        }

        const promptBuilder = new PromptBuilder(this.config.gemini.max_prompt_tokens!);

        // 1. Build the file context string.
        const fileContextString = promptBuilder.buildFilesPrompt(filteredFileContents, this.projectRoot);

        // 2. Check for existing file context in the conversation.
        const existingFileContextMessageIndex = conversation.getMessages().findIndex(message => message.content.startsWith(this.filePrefix));

        // 3. Modify the *existing* conversation object in place.
        if (existingFileContextMessageIndex !== -1) {
            // 3a. If found, *remove* the old file context message.
            conversation.getMessages().splice(existingFileContextMessageIndex, 1);
        }

        // 4. Add file context string
        conversation.addMessage("system", this.filePrefix + fileContextString);

        // 5. Add user prompt
        const instructedPrompt = `
          ${userPrompt}

        Give a concise answer with code changes ONLY, in a SINGLE response:
            - Do NOT provide multiple options or alternatives.
            - Focus on the most sustainable and maintainable solution.
            - Include file creation, deletion, or moves in the diff if necessary.
            - Use the unified diff format and do not hallucinate filenames, only use file names that I have provided in the file context.
            - If the changes required are extensive, omit the explanation and include ONLY the diff.
            - The changes you suggest MUST be comprehensive. Do not suggest partial code snippets that will not run.
        `;
        conversation.addMessage("user", instructedPrompt);
        return conversation;
    }

    // Finds relevant files in the project, excluding ignored files/directories
    private async findRelevantFiles(): Promise<string[]> {
        return new RelevantFileFinder(this.fs).findRelevantFiles(this.projectRoot);
    }

    // Processes the AI's response string, extracting diffs and explanations
    private processAIResponse(aiResponseString: string): AIResponse {
        const diffFiles = this.extractDiffs(aiResponseString);
        const explanation = this.extractExplanation(aiResponseString); //still extract.
        const message = this.extractMessage(aiResponseString, explanation, diffFiles);

        return { message: message.trim(), diffFiles, explanation };
    }

    // Extracts unified diff blocks from the AI response
    private extractDiffs(aiResponse: string): DiffFile[] | null {
        const diffRegex = /```diff\n([\s\S]+?)\n```/g;  // Regex to get content between ```diff
        const files: DiffFile[] = [];
        let match;

        while ((match = diffRegex.exec(aiResponse)) !== null) {
            const diffContent = match[1];

            // Extract file paths from the diff content itself
            const filePaths = this.extractFilePathsFromDiff(diffContent);
            if(filePaths)
                files.push({ path: filePaths.toPath, content: diffContent }); // Use likely file path
        }

        return files.length > 0 ? files : null;
    }
    //Added support for diff file paths.
    private extractFilePathsFromDiff(diffContent: string): { fromPath: string; toPath: string } | null {
        const pathRegex = /--- a\/([^\n]+)\n\+\+\+ b\/([^\n]+)/;
        const match = diffContent.match(pathRegex);
        if (match) {
            return {
                fromPath: match[1].trim(),
                toPath: match[2].trim(),
            };
        }
        return null;
    }

    // Extract explanation, if it exists
    private extractExplanation(aiResponse: string): string {
        const explanationRegex = /\*\*Explanation of Changes and Key Points\*\*([\s\S]*?)(?:File:|$)/;
        const match = aiResponse.match(explanationRegex);
        return match ? match[1].trim() : ""; // Return even if empty.
    }
    // Extract message content by removing diff and explanation blocks
    private extractMessage(aiResponse: string, explanation: string, diffFiles: DiffFile[] | null): string {
        let message = aiResponse;

        if (explanation) {
            const explanationRegex = new RegExp(`\\*\\*Explanation of Changes and Key Points\\*\\*[\\s\\S]*?(?:File:|${escapeRegExp(message.slice(-10))}|$ )`);
            message = message.replace(explanationRegex, '').trim();
        }
        if (diffFiles) {
            diffFiles.forEach(diffFile => {
                const diffBlockRegex = new RegExp("```diff\\n[\\s\\S]*?\\n```", 'g');
                message = message.replace(diffBlockRegex, '').trim();
            });
        }
        return message.trim();
    }

    // Sets the current diff for later application
    public setCurrentDiff(diff: DiffFile[]): void {
        this.currentDiff = diff;
    }

    // Applies the current diff to the project files
    public async applyDiff(): Promise<void> {
        if (!this.currentDiff) {
            throw new Error("No diff to apply.");
        }

        for (const diffFile of this.currentDiff) {
            const fullPath = path.join(this.projectRoot, diffFile.path);
            const originalContent = await this.fs.readFile(fullPath) || '';

            // Use the diff library to apply the patch
            const patchedContent = Diff.applyPatch(originalContent, diffFile.content);

            if (patchedContent === false) {
                // Patch failed.  Attempt reconciliation.
                console.warn(`Diff application failed for ${diffFile.path}. Attempting AI reconciliation.`);
                const reconciledContent = await this.reconcileDiffWithAI(originalContent, diffFile.content);
                if (reconciledContent !== null) {
                    await this.fs.writeFile(fullPath, reconciledContent);
                    console.log(`AI reconciliation successful for ${diffFile.path}.`);
                } else {
                    // If AI reconciliation also fails, throw error
                    throw new Error(`Failed to apply diff and AI reconciliation failed for ${diffFile.path}.`);
                }
            } else {
                // Patch applied successfully.
                await this.fs.writeFile(fullPath, patchedContent);
                console.log(`Applied diff to ${diffFile.path}`);
            }

        }
    }

    // Uses AI to reconcile a failed diff application
    private async reconcileDiffWithAI(originalContent: string, diffContent: string): Promise<string | null> {
        const prompt = `I have a file with the following content:\n\`\`\`\n${originalContent}\n\`\`\`\n\nI tried to apply the following diff, but it failed:\n\`\`\`diff\n${diffContent}\n\`\`\`\n\nPlease provide the complete, corrected file content after applying the changes, taking into account any potential conflicts or misalignments in the diff.  Do NOT include any explanations, preambles, or apologies. Give ONLY the corrected file contents.`;

        try {
            const conversation = new Conversation();
            conversation.addMessage('user', prompt);
            const reconciledContent = await this.aiClient.getResponseFromAI(conversation, "gpt-4o"); // Use AIClient
            return reconciledContent;
        } catch (error) {
            console.error("Error in AI reconciliation:", error);
            return null;
        }
    }

    //For checking the type of response that came back from Gemini
    public async checkResponse(prompt: string): Promise<string> {
        let conversation = this.conversationManager.createConversation();
        conversation.conversation.addMessage("user", prompt)
        const aiResponse = await this.aiClient.getResponseFromAI(conversation.conversation, "gpt-4o"); // Use AI Client
        return aiResponse;
    }
}

// Helper function (remains the same)
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Helper Classes ---

export { CodeProcessor };