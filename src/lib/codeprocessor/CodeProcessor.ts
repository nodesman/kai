// File: src/lib/codeprocessor/CodeProcessor.ts

import {FileSystem} from '../FileSystem';
import {AIClient} from '../AIClient';
import {Config} from "../Config";
import {DiffFile} from '../types';
import {Conversation} from '../models/Conversation';
import {ConversationManager} from '../ConversationManager';
import RelevantFileFinder from "./RelevantFileFinder";
import PromptBuilder from "./PromptBuilder";
import path from "path";
import { WebSocketPrompts } from '../prompts'; // <-- ADD THIS IMPORT


interface AIResponse {
    message: string;
    diffFiles: DiffFile[] | null;
    explanation: string | null;
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

    // --- Main Entry Point ---
    public async askQuestion(userPrompt: string, conversation: Conversation): Promise<AIResponse> {
        console.log(`[CodeProcessor] askQuestion: Received user prompt: ${userPrompt}`);

        const isDiffPrompt = await this.isDiffPrompt(userPrompt);
        console.log(`[CodeProcessor] askQuestion: isDiffPrompt result: ${isDiffPrompt}`);

        const updatedConversation = await this.buildPromptString(userPrompt, conversation);
        console.log(`[CodeProcessor] askQuestion: Built prompt string. Conversation ID: ${updatedConversation.getId()}`);

        // TODO: Pass conversationFilePath and useFlashModel based on context
        let aiResponseString = await this.aiClient.getResponseFromAI(updatedConversation /*, conversationFilePath, contextString, useFlashModel */);
        updatedConversation.addMessage('assistant', aiResponseString); //add it to conversation
        console.log(`[CodeProcessor] askQuestion: Received response from AI.  Response length: ${aiResponseString.length}`);

        const aiResponse = await this.processAIResponse(aiResponseString, isDiffPrompt);
        console.log(`[CodeProcessor] askQuestion: Processed AI response.  Has diffs: ${!!aiResponse.diffFiles}, Has explanation: ${!!aiResponse.explanation}`);
        return aiResponse;
    }

    // --- Prompt Building ---
    private async buildPromptString(userPrompt: string, conversation: Conversation): Promise<Conversation> {
        console.log(`[CodeProcessor] buildPromptString: Starting prompt building.`);
        const relevantFilePaths = await this.findRelevantFiles();
        console.log(`[CodeProcessor] buildPromptString: Found ${relevantFilePaths.length} relevant files.`);
        const fileContents = await this.fs.readFileContents(relevantFilePaths);

        const filteredFileContents: { [filePath: string]: string } = {};
        for (const filePath in fileContents) {
            if (fileContents[filePath] !== null) {
                filteredFileContents[filePath] = fileContents[filePath]!;
            }
        }
        console.log(`[CodeProcessor] buildPromptString: Read contents of ${Object.keys(filteredFileContents).length} files.`);

        const promptBuilder = new PromptBuilder(this.config.gemini.max_prompt_tokens!);
        const fileContextString = promptBuilder.buildFilesPrompt(filteredFileContents, this.projectRoot);
        console.log(`[CodeProcessor] buildPromptString: Built file context string. Length: ${fileContextString.length}`);

        const existingFileContextMessageIndex = conversation.getMessages().findIndex(message => message.content.startsWith(this.filePrefix));
        console.log(`[CodeProcessor] buildPromptString: Existing file context message index: ${existingFileContextMessageIndex}`);

        if (existingFileContextMessageIndex !== -1) {
            conversation.getMessages().splice(existingFileContextMessageIndex, 1);
            console.log(`[CodeProcessor] buildPromptString: Removed existing file context message.`);
        }

        conversation.addMessage("system", this.filePrefix + fileContextString);
        console.log(`[CodeProcessor] buildPromptString: Added file context to conversation.`);

        // --- Use imported prompt function ---
        // Construct the prompt using the user's input and the standard instructions
        const instructedPrompt = WebSocketPrompts.instructedPrompt(userPrompt);
        // --- End modification ---

        conversation.addMessage("user", instructedPrompt);
        console.log(`[CodeProcessor] buildPromptString: Added user prompt to conversation.`);
        return conversation;
    }

    // --- File System Interactions ---
    private async findRelevantFiles(): Promise<string[]> {
        console.log(`[CodeProcessor] findRelevantFiles: Finding relevant files...`);
        const relevantFiles = await new RelevantFileFinder(this.fs).findRelevantFiles(this.projectRoot);
        console.log(`[CodeProcessor] findRelevantFiles: Found ${relevantFiles.length} relevant files.`);
        return relevantFiles;
    }

    // --- AI Response Processing (NOW USES AI FOR EXTRACTION) ---
    private async processAIResponse(aiResponseString: string, isDiffPrompt: boolean): Promise<AIResponse> {
        console.log(`[CodeProcessor] processAIResponse: Processing AI response using AI.`);

        // --- Use imported prompt function ---
        // Use GPT-4o-mini to analyze the Gemini response.
        const analysisPrompt = WebSocketPrompts.responseAnalysisPrompt(aiResponseString);
        // --- End modification ---

        const conversation = new Conversation();
        conversation.addMessage('user', analysisPrompt);
        // TODO: Pass useFlashModel based on context/config if necessary for analysis
        const analysisResponse = await this.aiClient.getResponseTextFromAI(conversation.getMessages(), true); // Use text generation, potentially flash
        console.log(`[CodeProcessor] processAIResponse: AI analysis response:`, analysisResponse);

        // Remove markdown code block delimiters if present
        const cleanedAnalysisResponse = analysisResponse.replace(/^```(json)?\n/, '').replace(/```$/, '');

        let parsedResponse: {
            containsDiff: boolean;
            containsExplanation: boolean;
            files: string[] | null;
            explanation: string | null;
            message: string | null
        };
        try {
            parsedResponse = JSON.parse(cleanedAnalysisResponse);
            if (typeof parsedResponse !== 'object' || parsedResponse === null) {
                throw new Error("Invalid JSON response from analysis.");
            }
            // Check for all required fields
            if (typeof parsedResponse.containsDiff !== 'boolean' ||
                typeof parsedResponse.containsExplanation !== 'boolean' ||
                (parsedResponse.files !== null && !Array.isArray(parsedResponse.files)) || // Allow null, but if present must be array
                (parsedResponse.explanation !== null && typeof parsedResponse.explanation !== 'string') || // Allow null, but if present must be string
                typeof parsedResponse.message !== 'string' //message can never be null.
            ) {
                throw new Error("Invalid JSON response from analysis: missing or incorrect fields.");
            }

        } catch (error) {
            console.error(`[CodeProcessor] processAIResponse: Error parsing AI analysis response:`, error);
            console.error(`[CodeProcessor] processAIResponse: Raw AI response:`, analysisResponse); //log original to help.
            throw new Error("Failed to parse AI response analysis: " + error);
        }

        // Construct the diffFiles array based on the analysis
        let diffFiles: DiffFile[] | null = null;
        if (parsedResponse.containsDiff && parsedResponse.files) {
            diffFiles = [];
            for (const filePath of parsedResponse.files) {  // Iterate through *all* extracted file paths

               const diff = extractDiffForFile(aiResponseString, filePath); // Implement extractDiffForFile
               if (diff) {
                   diffFiles.push({ path: filePath, content: diff });
               } else {
                   console.warn(`[CodeProcessor] processAIResponse: No diff found for file ${filePath}`);
                   //Should handle missing diff content. For now, skip the file
                   // TODO: Revisit this - maybe the AI analysis should provide the diff content directly?
                   // Pushing the full aiResponseString is incorrect.
                   // diffFiles.push({path: filePath, content: aiResponseString}) // This is wrong
                   continue;
               }
            }
            if (diffFiles.length > 0) {
                this.setCurrentDiff(diffFiles); //save the file.
            } else {
                diffFiles = null; // Ensure it's null if no valid diffs were extracted
            }
        }

        return {
            message: parsedResponse.message || "", // Default to empty string if message is missing
            diffFiles,
            explanation: parsedResponse.containsExplanation ? parsedResponse.explanation : null,
        };
    }


    // Helper method to check if a prompt is likely a diff request (using GPT-4o-mini)
    private async isDiffPrompt(prompt: string): Promise<boolean> {
        console.log(`[CodeProcessor] isDiffPrompt: Checking if prompt is a diff request. Prompt: ${prompt}`);
        // --- Use imported prompt function ---
        const checkPrompt = WebSocketPrompts.diffCheckPrompt(prompt);
        // --- End modification ---
        const conversation = new Conversation("", [{role: 'user', content: checkPrompt}]);
        try {
            // TODO: Pass useFlashModel based on context/config
            const response = await this.aiClient.getResponseTextFromAI(conversation.getMessages(), true); // Use text generation, potentially flash
            const isDiff = response.toLowerCase().includes("true");
            console.log(`[CodeProcessor] isDiffPrompt: AI response: ${response}, isDiff: ${isDiff}`);
            return isDiff;
        } catch (error) {
            console.error(`[CodeProcessor] isDiffPrompt: Error checking diff prompt:`, error);
            return false; // Default to false on error
        }
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

        const applyPromises = this.currentDiff.map(async (diffFile) => {
            const fullPath = path.join(this.projectRoot, diffFile.path);
             // Ensure the file path exists before applying changes (except for creation)
             if (!diffFile.content.startsWith("+++")) { // Don't check for existence if creating
                try {
                    await this.fs.access(fullPath);
                } catch (error) {
                    // If it's a regular diff or deletion but file doesn't exist, skip or error
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                        console.warn(`[CodeProcessor] applyDiff: File not found, skipping operation for ${diffFile.path}`);
                        return; // Skip this file
                    } else {
                        console.error(`[CodeProcessor] applyDiff: Error accessing file ${diffFile.path}:`, error);
                        throw error; // Rethrow other access errors
                    }
                }
            }


            if (diffFile.content.startsWith("---") && diffFile.content.includes("+++")) { // Regular diff (modify)
                console.log(`[CodeProcessor] applyDiff: Applying diff to file: ${fullPath}`);
                try {
                    // TODO: FileSystem needs an applyDiffToFile method
                    // await this.fs.applyDiffToFile(diffFile.path, diffFile.content, this.projectRoot); //apply diff
                     console.warn(`[CodeProcessor] applyDiff: applyDiffToFile not implemented in FileSystem. Skipping ${diffFile.path}`);

                } catch (error) {
                    console.error(`[CodeProcessor] applyDiff: Error applying diff to ${diffFile.path}:`, error);
                    throw error; // Re-throw after logging
                }

            } else if (diffFile.content.startsWith("+++")) {  // Creating files
                console.log(`[CodeProcessor] applyDiff: Creating file: ${fullPath}`);
                // Extract content after '+++ b/...' line
                const lines = diffFile.content.split('\n');
                let contentStartIndex = lines.findIndex(line => line.startsWith('+') && !line.startsWith('+++')); // Find first actual content line
                if (contentStartIndex === -1) contentStartIndex = 1; // Fallback if no '+' lines (empty file creation?)
                const content = lines.slice(contentStartIndex).map(l => l.startsWith('+') ? l.substring(1) : l).join('\n'); // Remove leading '+'

                 // Ensure directory exists
                 await this.fs.ensureDirExists(path.dirname(fullPath));
                 await this.fs.writeFile(fullPath, content);


            } else if (diffFile.content.startsWith("---") && !diffFile.content.includes("+++")) { // Deleting files (only --- lines)
                console.log(`[CodeProcessor] applyDiff: Deleting file: ${fullPath}`);
                try {
                    await this.fs.deleteFile(fullPath);
                } catch (error) {
                     if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { // Don't error if already deleted
                        console.error(`[CodeProcessor] applyDiff: Error deleting file ${diffFile.path}:`, error);
                        throw error;
                     } else {
                        console.log(`[CodeProcessor] applyDiff: File already deleted: ${fullPath}`);
                     }
                }

            } else {
                console.error(`[CodeProcessor] applyDiff: Unrecognized diff format for file: ${diffFile.path}`);
                throw new Error(`Unrecognized diff format for file: ${diffFile.path}`);
            }
        });
        await Promise.all(applyPromises); // Apply all diffs in parallel
        console.log(`[CodeProcessor] applyDiff: Finished applying diff.`);
        this.currentDiff = null; // Clear diff after applying
    }

    //For checking the type of response that came back from Gemini
    public async checkResponse(prompt: string): Promise<string> { // NOTE: Parameter name 'prompt' might be misleading here, it's the AI response text
        const aiResponseText = prompt; // Rename for clarity inside the function
        console.log(`[CodeProcessor] checkResponse: Checking response: ${aiResponseText.substring(0, 100)}...`); // Log start of text
        let conversation = this.conversationManager.createConversation();

        // --- Use imported prompt function ---
        const commentCheckPrompt = WebSocketPrompts.commentCheckPrompt(aiResponseText);
        // --- End modification ---

        conversation.conversation.addMessage("user", commentCheckPrompt); // Use the generated prompt
        try {
             // TODO: Pass useFlashModel based on context/config
            const aiResponse = await this.aiClient.getResponseTextFromAI(conversation.conversation.getMessages(), true); // Use text generation, potentially flash
            console.log(`[CodeProcessor] checkResponse: Received check result from AI. Length: ${aiResponse.length}`);
            return aiResponse;
        } catch (error) {
            console.error(`[CodeProcessor] checkResponse: Error checking response:`, error);
            throw error; // Re-throw for consistency
        }
    }
}


// Helper function to extract the diff for a specific file
function extractDiffForFile(aiResponseString: string, filePath: string): string | null {
    // This regex attempts to find a standard diff block for the specified file.
    // It looks for `--- a/filepath` followed by `+++ b/filepath` and captures everything until the next `--- a/` or the end of the string.
    // Handles potential variations in paths (e.g., leading ./ or just the path)
    const safeFilePath = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex special chars in filepath
    const diffRegex = new RegExp(
        `^--- (?:a\\/)?${safeFilePath}\\r?\\n\\+\\+\\+ (?:b\\/)?${safeFilePath}\\r?\\n((?:.|\\r?\\n)*?)(?=\\r?\\n--- (?:a\\/)|$)`,
        'm' // Multiline mode
    );

    const match = aiResponseString.match(diffRegex);

    if (match && match[0]) {
        // Return the full matched diff block including headers
        return match[0].trim();
    } else {
        // Fallback or alternative regex patterns could be added here if needed.
        // Check for simple creation/deletion markers if the main regex fails
        // (This part needs careful design based on expected AI output formats)

        // Example: Check for a block starting with +++ b/filepath and nothing else complex
        const creationRegex = new RegExp(`^\\+\\+\\+ (?:b\\/)?${safeFilePath}\\r?\\n((?:.|\\r?\\n)*?)(?=\\r?\\n--- (?:a\\/)|$)`, 'm');
        const creationMatch = aiResponseString.match(creationRegex);
        if (creationMatch && creationMatch[0] && !aiResponseString.includes(`--- a/${filePath}`)) {
             return creationMatch[0].trim(); // Likely file creation
        }

         // Example: Check for --- a/filepath with no following +++ b/filepath before next file
         const deletionRegex = new RegExp(`^--- (?:a\\/)?${safeFilePath}\\r?\\n(?!(?:.|\\r?\\n)*^\\+\\+\\+ (?:b\\/)?${safeFilePath}\\r?\\n)((?:.|\\r?\\n)*?)(?=\\r?\\n--- (?:a\\/)|$)`, 'm');
         const deletionMatch = aiResponseString.match(deletionRegex);
         if (deletionMatch && deletionMatch[0]) {
             return deletionMatch[0].trim(); // Likely file deletion marker
         }

    }


    return null; // No diff found for this file
}

export {CodeProcessor};