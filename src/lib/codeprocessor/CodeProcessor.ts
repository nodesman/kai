// File: src/lib/codeprocessor/CodeProcessor.ts

import { FileSystem } from '../FileSystem';
import { AIClient } from '../AIClient';
import { Config } from "../Config";
import { DiffFile } from '../types';
import { Conversation } from '../models/Conversation';
import { ConversationManager } from '../ConversationManager';
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
    private aiClient: AIClient;
    private projectRoot: string;
    private currentDiff: DiffFile[] | null = null;
    private conversationManager: ConversationManager;
    private readonly filePrefix: string = "### File Context ###\n";


    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);
        this.projectRoot = process.cwd();
        this.conversationManager = ConversationManager.getInstance();
    }

    // Main entry point for processing user requests
    public async askQuestion(userPrompt: string, conversation: Conversation): Promise<AIResponse> {
        console.log(`[CodeProcessor] askQuestion: Received user prompt: ${userPrompt}`);

        // 1. Check if the prompt is a "diff" prompt using GPT-4o-mini via the AIClient
        const isDiffPrompt = await this.isDiffPrompt(userPrompt);
        console.log(`[CodeProcessor] askQuestion: isDiffPrompt result: ${isDiffPrompt}`);

        // 2. Build the complete prompt, including file context.
        const updatedConversation = await this.buildPromptString(userPrompt, conversation);
        console.log(`[CodeProcessor] askQuestion: Built prompt string. Conversation ID: ${updatedConversation.getId()}`);

        // 3. Get response from Gemini 2 Pro (via AIClient).
        let aiResponseString = await this.aiClient.getResponseFromAI(updatedConversation);  // No model name needed - defaults to Gemini
        updatedConversation.addMessage('assistant', aiResponseString); //add it to converation
        console.log(`[CodeProcessor] askQuestion: Received response from AI.  Response length: ${aiResponseString.length}`);

        // 4. Process the response, check for explanation
        const aiResponse = this.processAIResponse(aiResponseString);
        console.log(`[CodeProcessor] askQuestion: Processed AI response.  Has diffs: ${!!aiResponse.diffFiles}, Has explanation: ${!!aiResponse.explanation}`);

        // 5. If it's a diff *and* there's an embedded explanation, extract it.
        if (aiResponse.diffFiles && aiResponse.explanation) {
            console.log(`[CodeProcessor] askQuestion: Diff response with explanation detected.`);
        }

        // 6. If no explanation but there are diffFiles, ask for one:
        if (aiResponse.diffFiles && !aiResponse.explanation) {
            console.log(`[CodeProcessor] askQuestion: Diff response without explanation. Requesting explanation...`);
            const explanationPrompt = `Explain the following code changes in detail, referencing filenames: \n\`\`\`diff\n${aiResponse.message}\n\`\`\``;
            const explanationConversation = new Conversation("", [{ role: 'user', content: explanationPrompt }]);
            try {
                const explanationResponse = await this.aiClient.getResponseFromAI(explanationConversation, "gpt-4o-mini"); // Specify model for explanation
                aiResponse.explanation = explanationResponse;  // Add the explanation
                console.log(`[CodeProcessor] askQuestion: Received explanation from AI. Explanation length: ${explanationResponse.length}`);
            } catch (error) {
                console.error(`[CodeProcessor] askQuestion: Error getting explanation:`, error);
                throw error; // Re-throw after logging

            }
        }

        console.log(`[CodeProcessor] askQuestion: Returning AI response to caller.`);
        return aiResponse;
    }

    // Helper method to check if a prompt is likely a diff request (using GPT-4o-mini)
    private async isDiffPrompt(prompt: string): Promise<boolean> {
        console.log(`[CodeProcessor] isDiffPrompt: Checking if prompt is a diff request. Prompt: ${prompt}`);
        const checkPrompt = `Does the following user prompt request changes to existing files in the codebase, including modifications or additions to existing files? 
        The prompt may be a generic question about the code base or not at all. Or a qeustion about how things are currenlty working. Or a question about how to achieve
        something in the code base. I am looking for the case where the user is asking how to get this code to work a certain way or what a certain outcome entail in terms of
        code changes. Respond with "true" or "false".\n\n${prompt}`;
        const conversation = new Conversation("", [{ role: 'user', content: checkPrompt }]);
        try {
            const response = await this.aiClient.getResponseFromAI(conversation, "gpt-4o-mini");  // Use AIClient, specify model
            const isDiff = response.toLowerCase().includes("true");
            console.log(`[CodeProcessor] isDiffPrompt: AI response: ${response}, isDiff: ${isDiff}`);
            return isDiff;
        } catch (error) {
            console.error(`[CodeProcessor] isDiffPrompt: Error checking diff prompt:`, error);
            return false; // Default to false on error
        }
    }

    // Builds the prompt string, including file context and user prompt
    private async buildPromptString(userPrompt: string, conversation: Conversation): Promise<Conversation> {
        console.log(`[CodeProcessor] buildPromptString: Starting prompt building.`);
        const relevantFilePaths = await this.findRelevantFiles();
        console.log(`[CodeProcessor] buildPromptString: Found ${relevantFilePaths.length} relevant files.`);
        const fileContents = await this.fs.readFileContents(relevantFilePaths);

        // Filter out null values (e.g., binary files, read errors):
        const filteredFileContents: { [filePath: string]: string } = {};
        for (const filePath in fileContents) {
            if (fileContents[filePath] !== null) {
                filteredFileContents[filePath] = fileContents[filePath]!; // Use non-null assertion
            }
        }
        console.log(`[CodeProcessor] buildPromptString: Read contents of ${Object.keys(filteredFileContents).length} files.`);

        const promptBuilder = new PromptBuilder(this.config.gemini.max_prompt_tokens!);

        // 1. Build the file context string.
        const fileContextString = promptBuilder.buildFilesPrompt(filteredFileContents, this.projectRoot);
        console.log(`[CodeProcessor] buildPromptString: Built file context string. Length: ${fileContextString.length}`);

        // 2. Check for existing file context in the conversation.
        const existingFileContextMessageIndex = conversation.getMessages().findIndex(message => message.content.startsWith(this.filePrefix));
        console.log(`[CodeProcessor] buildPromptString: Existing file context message index: ${existingFileContextMessageIndex}`);

        // 3. Modify the *existing* conversation object in place.
        if (existingFileContextMessageIndex !== -1) {
            // 3a. If found, *remove* the old file context message.
            conversation.getMessages().splice(existingFileContextMessageIndex, 1);
            console.log(`[CodeProcessor] buildPromptString: Removed existing file context message.`);
        }

        // 4. Add file context string
        conversation.addMessage("system", this.filePrefix + fileContextString);
        console.log(`[CodeProcessor] buildPromptString: Added file context to conversation.`);

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
        console.log(`[CodeProcessor] buildPromptString: Added user prompt to conversation.`);
        return conversation;
    }

    // Finds relevant files in the project, excluding ignored files/directories
    private async findRelevantFiles(): Promise<string[]> {
        console.log(`[CodeProcessor] findRelevantFiles: Finding relevant files...`);
        const relevantFiles = await new RelevantFileFinder(this.fs).findRelevantFiles(this.projectRoot);
        console.log(`[CodeProcessor] findRelevantFiles: Found ${relevantFiles.length} relevant files.`);
        return relevantFiles;
    }

    // Processes the AI's response string, extracting diffs and explanations
    private processAIResponse(aiResponseString: string): AIResponse {
        console.log(`[CodeProcessor] processAIResponse: Processing AI response. Response length: ${aiResponseString.length}`);
        const diffFiles = this.extractDiffs(aiResponseString);
        const explanation = this.extractExplanation(aiResponseString); //still extract.
        const message = this.extractMessage(aiResponseString, explanation, diffFiles);
        console.log(`[CodeProcessor] processAIResponse: Extracted diffs (count: ${diffFiles ? diffFiles.length : 0}), explanation (length: ${explanation.length}), message (length: ${message.length})`);
        return { message: message.trim(), diffFiles, explanation };
    }

    // Extracts unified diff blocks from the AI response
    private extractDiffs(aiResponse: string): DiffFile[] | null {
        console.log(`[CodeProcessor] extractDiffs: Extracting diffs from AI response.`);
        const diffRegex = /`diff\n([\s\S]+?)\n`/g;  // Regex to get content between ```diff
        const files: DiffFile[] = [];
        let match;

        while ((match = diffRegex.exec(aiResponse)) !== null) {
            const diffContent = match[1];
            console.log(`[CodeProcessor] extractDiffs: Found diff block. Length: ${diffContent.length}`);

            // Extract file paths from the diff content itself
            const filePaths = this.extractFilePathsFromDiff(diffContent);
            if (filePaths) {
                files.push({ path: filePaths.toPath, content: diffContent }); // Use likely file path
                console.log(`[CodeProcessor] extractDiffs: Extracted file path: ${filePaths.toPath}`);
            } else {
                console.warn(`[CodeProcessor] extractDiffs: Could not extract file paths from diff block.`);
            }
        }

        const result = files.length > 0 ? files : null;
        console.log(`[CodeProcessor] extractDiffs: Extracted ${result ? result.length : 0} diff files.`);
        return result;
    }
    //Added support for diff file paths.
    private extractFilePathsFromDiff(diffContent: string): { fromPath: string; toPath: string } | null {
        const pathRegex = /--- a\/([^\n]+)\n\+\+\+ b\/([^\n]+)/;
        const match = diffContent.match(pathRegex);
        if (match) {
            const fromPath = match[1].trim();
            const toPath = match[2].trim();
            console.log(`[CodeProcessor] extractFilePathsFromDiff: Extracted fromPath: ${fromPath}, toPath: ${toPath}`);
            return { fromPath, toPath };
        }
        console.log(`[CodeProcessor] extractFilePathsFromDiff: Could not extract file paths.`);
        return null;
    }

    // Extract explanation, if it exists
    private extractExplanation(aiResponse: string): string {
        console.log(`[CodeProcessor] extractExplanation: Extracting explanation from AI response.`);
        const explanationRegex = /\*\*Explanation of Changes and Key Points\*\*([\s\S]*?)(?:File:|$)/;
        const match = aiResponse.match(explanationRegex);
        const explanation = match ? match[1].trim() : ""; // Return even if empty.
        console.log(`[CodeProcessor] extractExplanation: Extracted explanation. Length: ${explanation.length}`);
        return explanation;
    }
    // Extract message content by removing diff and explanation blocks
    private extractMessage(aiResponse: string, explanation: string, diffFiles: DiffFile[] | null): string {
        console.log(`[CodeProcessor] extractMessage: Extracting message from AI response.`);
        let message = aiResponse;

        if (explanation) {
            console.log(`[CodeProcessor] extractMessage: Removing explanation from message.`);
            const explanationRegex = new RegExp(`\\*\\*Explanation of Changes and Key Points\\*\\*[\\s\\S]*?(?:File:|${escapeRegExp(message.slice(-10))}|$ )`);
            message = message.replace(explanationRegex, '').trim();
        }
        if (diffFiles) {
            console.log(`[CodeProcessor] extractMessage: Removing ${diffFiles.length} diff blocks from message.`);
            diffFiles.forEach(diffFile => {
                const diffBlockRegex = new RegExp("`diff\\n[\\s\\S]*?\\n`", 'g');
                message = message.replace(diffBlockRegex, '').trim();
            });
        }
        console.log(`[CodeProcessor] extractMessage: Extracted message. Length: ${message.length}`);
        return message.trim();
    }

    // Sets the current diff for later application
    public setCurrentDiff(diff: DiffFile[]): void {
        console.log(`[CodeProcessor] setCurrentDiff: Setting current diff. Number of files: ${diff.length}`);
        this.currentDiff = diff;
    }

    // Applies the current diff to the project files
    public async applyDiff(): Promise<void> {
        if (!this.currentDiff) {
            throw new Error("No diff to apply.");
        }

        console.log(`[CodeProcessor] applyDiff: Applying diff. Number of files: ${this.currentDiff.length}`);
        for (const diffFile of this.currentDiff) {
            const fullPath = path.join(this.projectRoot, diffFile.path);
            const originalContent = await this.fs.readFile(fullPath) || '';
            console.log(`[CodeProcessor] applyDiff: Applying diff to file: ${fullPath}`);

            // Use the diff library to apply the patch
            const patchedContent = Diff.applyPatch(originalContent, diffFile.content);

            if (patchedContent === false) {
                // Patch failed.  Attempt reconciliation.
                console.warn(`[CodeProcessor] applyDiff: Diff application failed for ${diffFile.path}. Attempting AI reconciliation.`);
                const reconciledContent = await this.reconcileDiffWithAI(originalContent, diffFile.content, diffFile.path); // Pass file path
                if (reconciledContent !== null) {
                    await this.fs.writeFile(fullPath, reconciledContent);
                    console.log(`[CodeProcessor] applyDiff: AI reconciliation successful for ${diffFile.path}.`);
                } else {
                    // If AI reconciliation also fails, throw error
                    console.error(`[CodeProcessor] applyDiff: Failed to apply diff and AI reconciliation failed for ${diffFile.path}.`);
                    throw new Error(`Failed to apply diff and AI reconciliation failed for ${diffFile.path}.`);
                }
            } else {
                // Patch applied successfully.
                await this.fs.writeFile(fullPath, patchedContent);
                console.log(`[CodeProcessor] applyDiff: Applied diff to ${diffFile.path}`);
            }

        }
        console.log(`[CodeProcessor] applyDiff: Finished applying diff.`);
    }

    // Uses AI to reconcile a failed diff application
    private async reconcileDiffWithAI(originalContent: string, diffContent: string, filePath: string): Promise<string | null> { // Added file path
        const prompt = `I have a file with the following content:\n\`\`\`\n${originalContent}\n\`\`\`\n\nI tried to apply the following diff, but it failed:\n\`\`\`diff\n${diffContent}\n\`\`\`\n\nPlease provide the complete, corrected file content after applying the changes, taking into account any potential conflicts or misalignments in the diff.  Do NOT include any explanations, preambles, or apologies. Give ONLY the corrected file contents.`;

        console.log(`[CodeProcessor] reconcileDiffWithAI: Attempting AI reconciliation for file: ${filePath}`);
        const conversation = new Conversation();
        conversation.addMessage('user', prompt);
        try {
            const reconciledContent = await this.aiClient.getResponseFromAI(conversation, "gpt-4o-mini"); // Use AIClient, specify model for reconciliation
            console.log(`[CodeProcessor] reconcileDiffWithAI: Received reconciled content from AI. Length: ${reconciledContent.length}`);
            return reconciledContent;
        } catch (error) {
            console.error(`[CodeProcessor] reconcileDiffWithAI: Error in AI reconciliation for file ${filePath}:`, error);
            return null;
        }
    }

    //For checking the type of response that came back from Gemini
    public async checkResponse(prompt: string): Promise<string> {
        console.log(`[CodeProcessor] checkResponse: Checking response for prompt: ${prompt}`);
        let conversation = this.conversationManager.createConversation();
        conversation.conversation.addMessage("user", prompt)
        try {
            const aiResponse = await this.aiClient.getResponseFromAI(conversation.conversation, "gpt-4o-mini"); // Use AI Client
            console.log(`[CodeProcessor] checkResponse: Received response from AI. Length: ${aiResponse.length}`);
            return aiResponse;
        } catch (error) {
            console.error(`[CodeProcessor] checkResponse: Error checking response:`, error);
            throw error; // Re-throw for consistency
        }
    }
}

// Helper function (remains the same)
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Helper Classes ---

export { CodeProcessor };