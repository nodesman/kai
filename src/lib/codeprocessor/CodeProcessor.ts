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

        let aiResponseString = await this.aiClient.getResponseFromAI(updatedConversation);
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

        // Use GPT-4o-mini to analyze the Gemini response.
        const analysisPrompt = `Analyze the following response from the AI. Determine if it contains only a unified diff, or if it also contains explanatory text. Extract all mentioned filenames.  Return a JSON object in the following format:
    {
      "containsDiff": boolean, // true if the response contains a diff, false otherwise
      "containsExplanation": boolean,  // true if there's explanatory text, false otherwise
      "files": string[], // An array of filenames extracted from the diff (if present)
      "explanation": string | null, // The explanation text, or null if no explanation.
      "message": string // main message
    }
    Ensure that the JSON object is valid. Do not wrap the JSON with markdown code blocks.

    AI Response:
    ${aiResponseString}
    `;

        const conversation = new Conversation();
        conversation.addMessage('user', analysisPrompt);
        const analysisResponse = await this.aiClient.getResponseFromAI(conversation, "gpt-4o-mini");
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

                const diffContentRegex = new RegExp(/--- a\/.+?\n\+\+\+ b\/.*/s);
                let extractedDiffContent;
                try {
                    extractedDiffContent = analysisResponse.match(diffContentRegex)?.[0] || null;
                } catch (e) {
                    console.log(e)
                }
                diffFiles.push({path: filePath, content: aiResponseString}) //This is wrong

                /*
               const diff = extractDiffForFile(aiResponseString, filePath); // Implement extractDiffForFile
               if (diff) {
                   diffFiles.push({ path: filePath, content: diff });
               } else {
                   console.warn(`[CodeProcessor] processAIResponse: No diff found for file ${filePath}`);
                   //Should handle missing diff content. For now, skip the file
                   continue;
               } */
            }

            this.setCurrentDiff(diffFiles); //save the file.
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
        const checkPrompt = `Does the following user prompt request changes to existing files in the codebase, including modifications or additions to existing files?
        The prompt may be a generic question about the code base or not at all. Or a qeustion about how things are currenlty working. Or a question about how to achieve
        something in the code base. I am looking for the case where the user is asking how to get this code to work a certain way or what a certain outcome entail in terms of
        code changes. Respond with "true" or "false".\n\n${prompt}`;
        const conversation = new Conversation("", [{role: 'user', content: checkPrompt}]);
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

            if (diffFile.content.startsWith("---")) {
                //It is a regular diff.
                console.log(`[CodeProcessor] applyDiff: Applying diff to file: ${fullPath}`);
                try {
                    await this.fs.applyDiffToFile(diffFile.path, diffFile.content, this.projectRoot); //apply diff
                } catch (error) {
                    console.error(`[CodeProcessor] applyDiff: Error applying diff to ${diffFile.path}:`, error);
                    throw error; // Re-throw after logging
                }

            } else if (diffFile.content.startsWith("+++")) {  // creating files
                //Creating a file
                console.log(`[CodeProcessor] applyDiff: Creating file: ${fullPath}`);
                const lines = diffFile.content.split('\n');
                if (lines.length > 1) {
                    const content = lines.slice(1).join('\n');
                    await this.fs.writeFile(fullPath, content);
                } else {
                    // Handle edge case: empty file
                    await this.fs.writeFile(fullPath, ""); // Create an empty file
                }

            } else if (diffFile.content.startsWith("---")) { //deleting files.
                console.log(`[CodeProcessor] applyDiff: Deleting file: ${fullPath}`);
                await this.fs.deleteFile(fullPath);

            } else {
                console.error(`[CodeProcessor] applyDiff: Unrecognized diff format for file: ${diffFile.path}`);
                throw new Error(`Unrecognized diff format for file: ${diffFile.path}`);
            }
        });
        await Promise.all(applyPromises); // Apply all diffs in parallel
        console.log(`[CodeProcessor] applyDiff: Finished applying diff.`);
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


// Helper function to extract the diff for a specific file
function extractDiffForFile(aiResponseString: string, filePath: string): string | null {
    // Implement logic to extract only the diff relevant to the specific file.
    // This might involve regular expressions or other parsing techniques.
    //It also is not clear what `extractDiffForFile` does or what an example might be.
    // This is a stub implementation.  Adapt this based on the AI's response structure.
    const diffStart = aiResponseString.indexOf(`--- a/${filePath}`);
    if (diffStart === -1) {
        return null;
    }

    const diffEnd = aiResponseString.indexOf("```", diffStart); // Find the end of the code block.

    if (diffEnd === -1) {
        return aiResponseString.substring(diffStart); // Assume rest of the message
    }
    return aiResponseString.substring(diffStart, diffEnd); //return all.
}

export {CodeProcessor};