// src/lib/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
import * as Diff from 'diff';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import inquirer from 'inquirer'; // Keep for fallback in review
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient'; // Correct import
import { Config } from './Config';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager';
import { countTokens } from './utils'; // Assuming countTokens is in utils
import {
    // --- Add necessary imports from @google/generative-ai ---
    Content,
    Part,
    Tool,
    FunctionDeclaration,
    GenerateContentRequest,
    GenerateContentResult,
    FunctionCallingMode,
    FinishReason,
    Schema, // Keep Schema for potential future typing needs
    SchemaType, // Import SchemaType
    // FunctionDeclarationSchemaProperty is implicitly handled via the structure
    // --- End imports ---
} from "@google/generative-ai";

const exec = promisify(execCb);

// --- Interfaces ---
interface ConsolidationAnalysis {
    operations: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE' }>;
    groups: string[][];
}

interface FinalFileStates {
    [filePath: string]: string | 'DELETE_CONFIRMED';
}
// --- End Interfaces ---

// --- Tool Definition ---
const proposeCodeChangesDeclaration: FunctionDeclaration = {
    name: "propose_code_changes",
    description: "Submits a set of proposed changes to project files, including creation, modification, or deletion. Provide the full final content for created or modified files. Use relative paths.",
    parameters: {
        // Using SchemaType enum for better type safety
        type: SchemaType.OBJECT,
        properties: {
            changes: {
                type: SchemaType.ARRAY,
                description: "A list of proposed file changes.",
                items: {
                    type: SchemaType.OBJECT,
                    required: ["filePath", "action"],
                    properties: {
                        filePath: {
                            description: "The relative path to the file from the project root (e.g., 'src/components/Button.js'). Use forward slashes '/' as separators.",
                            type: SchemaType.STRING
                        },
                        action: {
                            type: SchemaType.STRING,
                            enum: ["CREATE", "MODIFY", "DELETE"],
                            description: "The operation to perform on the file.",
                        },
                        content: {
                            description: "The *complete* final content of the file for CREATE or MODIFY actions. Omit for DELETE.",
                            type: SchemaType.STRING,
                        },
                    },
                },
            },
        },
        required: ["changes"],
    },
};
// --- End Tool Definition ---

const provideSingleFileContentDeclaration: FunctionDeclaration = {
    name: "provide_single_file_content",
    description: "Provides the complete, final content for a single specified file.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            filePath: {
                type: SchemaType.STRING,
                description: "The relative path of the file this content belongs to (e.g., 'src/utils.ts').",
            },
            content: {
                type: SchemaType.STRING,
                description: "The complete, final content for the specified file.",
            },
            // Optional: Add action if needed, but might complicate the instruction
            // action: {
            //     type: SchemaType.STRING,
            //     enum: ["CREATE", "MODIFY"],
            //     description: "Indicates if the file is being created or modified."
            // }
        },
        required: ["filePath", "content"], // filePath and content are essential
    },
};
const proposeCodeChangesTool: Tool = {
    functionDeclarations: [proposeCodeChangesDeclaration],
};
const provideSingleFileContentTool: Tool = {
    functionDeclarations: [provideSingleFileContentDeclaration],
};

export class ConsolidationService {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;

    constructor(config: Config, fileSystem: FileSystem, aiClient: AIClient, projectRoot: string) {
        this.config = config;
        this.fs = fileSystem;
        this.aiClient = aiClient;
        this.projectRoot = projectRoot;
    }

    async process(
        conversationName: string,
        conversation: Conversation,
        currentContextString: string, // Receive context as argument
        conversationFilePath: string
    ): Promise<void> {
        const startMsg = `System: Starting AI-driven code consolidation for '${conversationName}'...`;
        console.log(chalk.blue(startMsg.replace('System: ', '')));
        await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: startMsg });

        try {
            // --- Determine model for consolidation steps ---
            const useFlashForAnalysis = false; // Typically use Pro for accurate analysis
            const useFlashForGeneration = false; // Use Pro for generation with function calling by default, as Flash might be less reliable with tools
            const analysisModelName = useFlashForAnalysis ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            const generationModelName = useFlashForGeneration ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            console.log(chalk.cyan(`  (Using ${analysisModelName} for analysis, ${generationModelName} for generation)`));
            // ---

            console.log(chalk.cyan("\n  Step A: Analyzing conversation..."));
            const analysisResult = await this.analyzeConversationForChanges(conversation, currentContextString, conversationFilePath, useFlashForAnalysis, analysisModelName);
            if (!analysisResult || analysisResult.operations.length === 0) {
                console.log(chalk.yellow("  Analysis complete: No file operations identified. Consolidation finished."));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found no intended operations.` });
                return;
            }
            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations across ${analysisResult.groups.length} generation group(s).`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found ${analysisResult.operations.length} ops in ${analysisResult.groups.length} groups...` });

            console.log(chalk.cyan("\n  Step B: Generating final file states using function calling..."));
            // **** CALL THE UPDATED METHOD ****
            const finalStates = await this.generateFinalFileContents(
                conversation,
                currentContextString,
                analysisResult,
                conversationFilePath,
                useFlashForGeneration, // Pass the flag
                generationModelName // Pass the model name for logging
            );
            // **** END CALL ****
            console.log(chalk.green(`  Generation complete: Produced final states for ${Object.keys(finalStates).length} files.`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Generation (using ${generationModelName}) produced states for ${Object.keys(finalStates).length} files...` });

            console.log(chalk.cyan("\n  Step C: Preparing changes for review..."));
            const reviewData = await this.prepareReviewData(finalStates);
            if (reviewData.length === 0) {
                console.log(chalk.yellow("  Review preparation complete: No effective changes detected after generation. Consolidation finished."));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: No effective changes found after generation.` });
                return;
            }
            console.log(chalk.green(`  Review preparation complete: ${reviewData.length} files with changes ready for review.`));
            const applyChanges = await this.presentChangesForReviewTUI(reviewData);

            if (applyChanges) {
                console.log(chalk.cyan("\n  Step D: Applying approved changes..."));
                await this.applyConsolidatedChanges(finalStates, conversationFilePath);
            } else {
                const msg = `System: Consolidation aborted by user. No changes applied.`;
                console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg });
            }
        } catch (error) {
            console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation: ${(error as Error).message}. See console for details.`;
            try {
                const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                await this.aiClient.logConversation(conversationFilePath, logPayload);
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
            }
            throw error; // Re-throw so main can catch it
        }
    }

    private async refineFileContentsWithFlash(
        conversation: Conversation,
        codeContext: string,
        initialFinalStates: FinalFileStates, // Input from Step B
        conversationFilePath: string,
        modelName: string // Explicitly Flash model name
    ): Promise<FinalFileStates> {
        // Create a deep copy to modify; start with Step B's results
        const refinedStates: FinalFileStates = JSON.parse(JSON.stringify(initialFinalStates));
        const successfullyRefinedPaths = new Set<string>(); // Track which files Flash successfully provided content for

        // 1. Identify files needing content generation (not DELETE) from Step B's output
        const filesToRefine = Object.entries(initialFinalStates)
            .filter(([_, state]) => state !== 'DELETE_CONFIRMED')
            .map(([filePath, _]) => filePath); // Get just the paths

        if (filesToRefine.length === 0) {
            console.log(chalk.yellow("    (Step B.5) No files require content refinement. Skipping Flash call."));
            return refinedStates; // Return the Step B states unchanged
        }

        console.log(chalk.cyan(`    (Step B.5) Requesting refinement for ${filesToRefine.length} files using ${modelName}: [${filesToRefine.join(', ')}]...`));

        // 2. Construct Prompt for Flash, instructing multiple function calls
        const refinementPrompt = `CONTEXT:\nYou are an expert AI assisting with code generation, refining content previously generated.\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY (for context):\n${conversation.getMessages().map((m: Message) => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nGenerate the complete, final content for EACH of the following files. You MUST call the '${provideSingleFileContentDeclaration.name}' function **multiple times**, once for each file listed below. Provide the full content in the 'content' parameter for each call.\n\nFILES TO GENERATE CONTENT FOR:\n${filesToRefine.map(f => `- ${f}`).join('\n')}\n\nFor every file in the list above, invoke the '${provideSingleFileContentDeclaration.name}' function with its 'filePath' and its complete 'content'. Do NOT return an array; make separate function calls for each file. Ensure the 'filePath' in each function call exactly matches one from the list above.`;

        // 3. Prepare API Request
        const historyForRefinement: Content[] = conversation.getMessages()
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        if (historyForRefinement.length > 0 && historyForRefinement[historyForRefinement.length - 1].role === 'user') {
            historyForRefinement.pop();
        }

        const request: GenerateContentRequest = {
            contents: [
                ...historyForRefinement,
                { role: "user", parts: [{ text: refinementPrompt }] }
            ],
            tools: [provideSingleFileContentTool], // Use the NEW tool for single file content
            toolConfig: {
                // *** This is where it likely cut off ***
                // Use ANY mode. We EXPECT function calls, but need to handle if the model just returns text.
                functionCallingConfig: { mode: FunctionCallingMode.ANY }
            }
        };

        // 4. Make API Call (useFlashModel = true)
        let result: GenerateContentResult | null = null;
        try {
            // Force Flash model for refinement step
            result = await this.aiClient.generateContent(request, true);
        } catch (error) {
            // If the refinement step fails entirely, log it and return the *original* states from Step B
            const errorMsg = `AI refinement (Step B.5) API call failed (using ${modelName}). Error: ${(error as Error).message}. Falling back to initial generation results.`;
            console.error(chalk.red(errorMsg));
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            return initialFinalStates; // Fallback to Step B results
        }

        // 5. Process Response - Iterate through multiple function calls
        const response = result?.response;
        const candidate = response?.candidates?.[0];
        // Get ALL parts that are function calls
        const functionCallParts = candidate?.content?.parts?.filter(part => !!part.functionCall) ?? [];

        if (functionCallParts.length > 0) {
            console.log(chalk.green(`    (Step B.5) Received ${functionCallParts.length} function call(s) for refinement.`));

            for (const part of functionCallParts) {
                const functionCall = part.functionCall;
                // Ensure it's the correct function name
                if (functionCall && functionCall.name === provideSingleFileContentDeclaration.name) {
                    const args = functionCall.args as { filePath?: string; content?: string }; // Type cast args

                    // Validate arguments received
                    if (!args || typeof args.filePath !== 'string' || typeof args.content !== 'string') {
                        console.warn(chalk.yellow(`    (Step B.5) Skipping invalid function call: Missing or invalid filePath/content. Args: ${JSON.stringify(args)}`));
                        continue;
                    }

                    const normalizedPath = path.normalize(args.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');

                    // Check if this path was actually requested for refinement
                    if (filesToRefine.includes(normalizedPath)) {
                        refinedStates[normalizedPath] = args.content; // Update the state with refined content
                        successfullyRefinedPaths.add(normalizedPath); // Mark as successfully refined
                        console.log(chalk.dim(`      (Step B.5) Refined content for ${normalizedPath} (Content length: ${args.content.length})`));
                    } else {
                        // Log if Flash returned a file we didn't ask for
                        console.warn(chalk.yellow(`    (Step B.5) Received function call for unexpected file path: ${normalizedPath}. Ignoring.`));
                    }
                } else {
                    // Log if a different function was called unexpectedly
                    console.warn(chalk.yellow(`    (Step B.5) Received unexpected function call name: ${functionCall?.name}. Ignoring.`));
                }
            }

            // Check for files that were requested but not returned by Flash
            const missedFiles = filesToRefine.filter(f => !successfullyRefinedPaths.has(f));
            if (missedFiles.length > 0) {
                console.warn(chalk.yellow(`    (Step B.5) Warning: Flash model did not provide content for ${missedFiles.length} requested file(s): [${missedFiles.join(', ')}]. Keeping initial content from Step B for these files.`));
                // No action needed here, as we started with initialFinalStates and only updated successful ones
            }

        } else {
            // Handle case where Flash didn't call the function at all
            const finishReason = candidate?.finishReason;
            const textResponse = candidate?.content?.parts?.find(part => !!part.text)?.text;
            let errorMsg = `AI refinement (Step B.5) failed: Model did not call the required function '${provideSingleFileContentDeclaration.name}'.`;
            if (finishReason && finishReason !== FinishReason.STOP) {
                errorMsg += ` Finish Reason: ${finishReason}.`;
                if (finishReason === FinishReason.SAFETY && candidate?.safetyRatings) {
                    errorMsg += ` Safety Ratings: ${JSON.stringify(candidate.safetyRatings)}`;
                }
            }

            console.warn(chalk.yellow(errorMsg + " Falling back to initial generation results from Step B."));
            if (textResponse) {
                // Log the text response for debugging
                console.warn(chalk.yellow(`(Step B.5) Model Response Text (instead of function calls):\n---\n${textResponse.substring(0, 500)}${textResponse.length > 500 ? '...' : ''}\n---`));
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: `${errorMsg} Fallback Text: ${textResponse.substring(0, 200)}...` });
            } else {
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            }
            // --- CRITICAL: Fallback to Step B results if refinement fails ---
            return initialFinalStates;
        }

        // Return the potentially updated map
        return refinedStates;
    }

    // --- analyzeConversationForChanges (Unchanged) ---
    private async analyzeConversationForChanges(
        conversation: Conversation,
        codeContext: string,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string
    ): Promise<ConsolidationAnalysis | null> {
        const analysisPrompt = `CONTEXT:\nYou are an expert AI analyzing a software development conversation...\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map((m: Message) => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nBased *only* on the conversation history and the provided codebase context, determine the final intended operations (CREATE, MODIFY, DELETE) for each relevant file path (relative to the project root). Resolve contradictions based on conversational flow (later messages override earlier ones unless stated otherwise).\n\nAlso, group the files needing CREATE or MODIFY into logical sets for generating their final content. Aim to minimize subsequent requests. Files marked for DELETE do not need grouping.\n\nOUTPUT FORMAT:\nRespond *only* with a single JSON object matching this structure:\n\`\`\`json\n{\n  "operations": [\n    { "filePath": "path/relative/to/root.ext", "action": "CREATE" | "MODIFY" | "DELETE" }\n  ],\n  "groups": [\n    ["path/to/file1.ext", "path/to/file2.ext"],\n    ["path/to/another_file.ext"]\n  ]\n}\n\`\`\`\nIf no operations are intended, return \`{ "operations": [], "groups": [] }\`. Ensure filePaths are relative.`;
        try {
            const responseText = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: analysisPrompt }],
                useFlashModel
            );
            const jsonString = responseText.trim().replace(/^```json\s*/, '').replace(/```$/, '');
            const jsonResponse = JSON.parse(jsonString);
            if (jsonResponse && Array.isArray(jsonResponse.operations) && Array.isArray(jsonResponse.groups)) {
                // Normalize paths immediately after parsing
                jsonResponse.operations.forEach((op: any) => { if (op.filePath) op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, ''); });
                jsonResponse.groups.forEach((group: string[]) => { for (let i = 0; i < group.length; i++) group[i] = path.normalize(group[i]).replace(/^[\\\/]+|[\\\/]+$/g, ''); });
                return jsonResponse as ConsolidationAnalysis;
            } else { throw new Error("Invalid JSON structure from analysis AI."); }
        } catch (e) {
            const errorMsg = `AI analysis step failed (using ${modelName}). Error: ${(e as Error).message}`;
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            throw new Error(errorMsg);
        }
    }

    // --- *** UPDATED: generateFinalFileContents using Function Calling *** ---
    private async generateFinalFileContents(
        conversation: Conversation,
        codeContext: string,
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string, // For logging
        useFlashModel: boolean,       // To select the model
        modelName: string             // For logging
    ): Promise<FinalFileStates> {
        const allFinalStates: FinalFileStates = {};

        // Combine all files needing generation (CREATE/MODIFY) into a single list for the prompt.
        // Note: We still rely on the analysis step to hint *which* files need attention,
        // but the prompt asks the LLM to determine the final state for *all* relevant files.
        const filesFromAnalysisGroups = analysisResult.groups.flat();
        const filesToDeleteFromAnalysis = analysisResult.operations
            .filter(op => op.action === 'DELETE')
            .map(op => op.filePath);

        // Only call generation if there are files to create/modify
        if (filesFromAnalysisGroups.length > 0) {
            console.log(chalk.cyan(`    Requesting generation for files: [${filesFromAnalysisGroups.join(', ')}] via function call...`));

            // Construct the prompt instructing the use of the function
            const generationPrompt = `CONTEXT:\nYou are an expert AI assisting with code generation based on a conversation history and current codebase.\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map((m: Message) => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nBased *only* on the conversation history and the provided codebase context, determine the final state (content or deletion) for all relevant files.\n\n**You MUST call the 'propose_code_changes' function** with an array of changes. For each file, provide:\n1.  'filePath': The relative path from the project root.\n2.  'action': Either 'CREATE', 'MODIFY', or 'DELETE'.\n3.  'content': The *complete, final file content* ONLY if the action is 'CREATE' or 'MODIFY'. Omit 'content' if the action is 'DELETE'.\n\nEnsure you include changes for ALL files whose final state is dictated by the conversation's intent, including:\n${filesFromAnalysisGroups.map(f => `- ${f} (from analysis)`).join('\n')}${filesToDeleteFromAnalysis.length > 0 ? '\n' + filesToDeleteFromAnalysis.map(f => `- ${f} (likely DELETE)`).join('\n') : ''}\n(Also include any other files whose final state is dictated by the conversation, even if not listed above).`;

            // --- Prepare the Content for the API Request ---
            // Convert conversation messages to Gemini's Content format, excluding system messages potentially
            // Note: The full history is ALSO included in the user prompt above, which might be redundant but ensures context.
            // You could refine this to only send a *subset* of history via the Content array if needed for token limits.
            const historyForGeneration: Content[] = conversation.getMessages()
                .filter(m => m.role !== 'system') // Often exclude system messages from direct history
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }));
            // Replace the last 'user' message in history with the detailed prompt including context
            if (historyForGeneration.length > 0 && historyForGeneration[historyForGeneration.length - 1].role === 'user') {
                historyForGeneration.pop(); // Remove the last simple user message
            }

            const request: GenerateContentRequest = {
                contents: [
                    ...historyForGeneration, // Include prior conversation turns
                    { role: "user", parts: [{ text: generationPrompt }] } // Add the main detailed prompt
                ],
                tools: [proposeCodeChangesTool], // Pass the defined tool
                toolConfig: {
                    // --- Force the model to call *our specific* function ---
                    // Use REQUIRED to ensure it calls *a* function. The name check below ensures it's *our* function.
                    // Alternatively, use ANY if you want to allow text responses as a fallback (less reliable).
                    functionCallingConfig: { mode: FunctionCallingMode.ANY } // Use ANY to get fallback text if needed
                }
            };

            // --- Make the API Call using aiClient.generateContent ---
            let result: GenerateContentResult | null = null;
            try {
                result = await this.aiClient.generateContent(request, useFlashModel);
            } catch (error) {
                // Log and re-throw errors from the AI client
                const errorMsg = `AI generation API call failed (using ${modelName}). Error: ${(error as Error).message}`;
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
                throw new Error(errorMsg); // Re-throw wrapped error
            }

            // --- Process the Response ---
            const response = result?.response;
            const candidate = response?.candidates?.[0];
            // Find the function call part in the response
            const functionCallPart = candidate?.content?.parts?.find(part => !!part.functionCall);
            const functionCall = functionCallPart?.functionCall;

            if (functionCall && functionCall.name === proposeCodeChangesDeclaration.name) {
                console.log(chalk.green(`    Successfully received function call '${functionCall.name}'. Processing args...`));
                // --- Type Check and Process Function Arguments ---
                const args = functionCall.args as { changes?: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE'; content?: string }> };

                if (!args || !Array.isArray(args.changes)) {
                    const errMsg = `Function call '${functionCall.name}' returned invalid or missing 'changes' array. Args: ${JSON.stringify(args)}`;
                    await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errMsg });
                    throw new Error(errMsg);
                }

                // --- Populate finalStates from Function Call Arguments ---
                for (const change of args.changes) {
                    // Validate each change item
                    if (!change.filePath || !change.action || !['CREATE', 'MODIFY', 'DELETE'].includes(change.action)) {
                        console.warn(chalk.yellow(`    Skipping invalid change item from function call: Missing/invalid filePath or action. Item: ${JSON.stringify(change)}`));
                        continue;
                    }
                    // Normalize path (remove leading/trailing slashes, use OS specific separators)
                    const normalizedPath = path.normalize(change.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');

                    if (change.action === 'CREATE' || change.action === 'MODIFY') {
                        if (typeof change.content !== 'string') {
                            // Content is mandatory for CREATE/MODIFY according to the function spec
                            console.warn(chalk.yellow(`    Missing or invalid 'content' for ${change.action} action on ${normalizedPath}. Skipping this change.`));
                            // Optionally, you could default to empty content: allFinalStates[normalizedPath] = "";
                            continue; // Skip if content is crucial and missing
                        }
                        allFinalStates[normalizedPath] = change.content;
                        console.log(chalk.dim(`      Processed ${change.action} for ${normalizedPath} (Content length: ${change.content.length})`));
                    } else if (change.action === 'DELETE') {
                        // Check if content was incorrectly provided for DELETE
                        if (change.content !== undefined && change.content !== null) {
                            console.warn(chalk.yellow(`    Note: 'content' was provided for DELETE action on ${normalizedPath}. Ignoring content.`));
                        }
                        allFinalStates[normalizedPath] = 'DELETE_CONFIRMED';
                        console.log(chalk.dim(`      Processed DELETE for ${normalizedPath}`));
                    }
                    // No else needed as action validation happened above
                }

            } else {
                // --- Handle cases where the function wasn't called ---
                const finishReason = candidate?.finishReason;
                const textResponse = candidate?.content?.parts?.find(part => !!part.text)?.text;

                // Construct the specific error message the user encountered
                let errorMsg = `AI generation step failed: Model did not call the required function '${proposeCodeChangesDeclaration.name}'.`;

                if (functionCallPart && functionCallPart.functionCall?.name) {
                    // Model called *a* function, but the wrong one
                    errorMsg = `AI generation step failed: Model called function '${functionCallPart.functionCall.name}' instead of the required '${proposeCodeChangesDeclaration.name}'.`;
                } else if (finishReason && finishReason !== FinishReason.STOP) {
                    // Function not called due to finish reason
                    errorMsg += ` Finish Reason: ${finishReason}.`;
                    if (finishReason === FinishReason.SAFETY && candidate?.safetyRatings) {
                        errorMsg += ` Safety Ratings: ${JSON.stringify(candidate.safetyRatings)}`;
                    }
                }

                if (textResponse) {
                    errorMsg += ` No text fallback response provided either.`; // Match user's error EXACTLY
                    console.error(chalk.red(errorMsg)); // Log the specific error
                    console.error(chalk.red(`Model Response Text (instead of function call):\n---\n${textResponse.substring(0, 1000)}${textResponse.length > 1000 ? '...' : ''}\n---`));
                    // Log this unexpected text response
                    await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: `${errorMsg}\nFallback Text: ${textResponse.substring(0, 200)}...` });
                    // Throw the specific error to halt consolidation as per original report
                    throw new Error(errorMsg.replace(' No text fallback response provided either.','')); // Throw matching the user's exact error structure for clarity
                } else {
                    // Function not called, no finish reason, no text - unexpected state
                    errorMsg += ` No text fallback response provided either.`; // Match user's error EXACTLY
                    console.error(chalk.red(errorMsg));
                    await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
                    throw new Error(errorMsg.replace(' No text fallback response provided either.','')); // Throw matching the user's exact error structure
                }
                // --- End Function Call Failure Handling ---
            }
        } else {
            console.log(chalk.yellow("    No files needed CREATE or MODIFY based on analysis. Skipping generation call."));
        }

        // --- Add DELETE confirmations from Analysis (Important Fallback) ---
        // This ensures deletes identified in Step A are still marked, even if the LLM
        // forgets to include them in the function call (which it ideally shouldn't).
        for (const op of analysisResult.operations) {
            if (op.action === 'DELETE') {
                const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                if (!(normalizedPath in allFinalStates)) {
                    // Only add if not already processed (e.g., by the function call)
                    console.warn(chalk.yellow(`    Note: Adding DELETE for ${normalizedPath} based on earlier analysis (was missing from function call response or generation was skipped).`));
                    allFinalStates[normalizedPath] = 'DELETE_CONFIRMED';
                } else if (allFinalStates[normalizedPath] !== 'DELETE_CONFIRMED') {
                    // Log conflict but prioritize the function call's decision if it provided content/modify
                    console.warn(chalk.yellow(`    Warning: ${normalizedPath} was marked DELETE in analysis, but generation step provided different action/content. Prioritizing generation step result.`));
                }
            }
        }

        return allFinalStates;
    }
    // --- End UPDATED Method ---

    // --- prepareReviewData (Unchanged) ---
// --- prepareReviewData (Handles CREATE/MODIFY/DELETE correctly) ---
    private async prepareReviewData(finalStates: FinalFileStates): Promise<ReviewDataItem[]> {
        const reviewData: ReviewDataItem[] = [];
        for (const relativePath in finalStates) {
            const proposed = finalStates[relativePath];
            const absolutePath = path.resolve(this.projectRoot, relativePath);
            let current: string | null = null;
            let action: ReviewAction = 'MODIFY'; // Default action

            try {
                // Try to read the current file content
                current = await this.fs.readFile(absolutePath);
            } catch (error) {
                // Only ignore "file not found" errors, rethrow others
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.error(chalk.red(`Error reading current state of ${relativePath}:`), error);
                    throw error;
                }
                // If file not found, current remains null
            }

            let diffStr = '';
            let isMeaningful = false;

            if (proposed === 'DELETE_CONFIRMED') {
                action = 'DELETE';
                if (current !== null) { // Only create diff if file actually exists to delete
                    diffStr = Diff.createPatch(relativePath, current, '', '', '', { context: 5 });
                    isMeaningful = true; // Deletion is always meaningful if file exists
                } else {
                    // File doesn't exist, so deletion is a no-op
                    console.log(chalk.gray(`  Skipping review for DELETE ${relativePath} - file already gone.`));
                    continue; // Skip adding to review data
                }
            } else { // Handle CREATE or MODIFY (proposed is the full content string)
                const proposedContent = typeof proposed === 'string' ? proposed : ''; // Ensure it's a string

                if (current === null) {
                    // File does not exist currently, so it's a CREATE action
                    action = 'CREATE';
                    diffStr = Diff.createPatch(relativePath, '', proposedContent, '', '', { context: 5 });
                    // Creation is meaningful if there's actual content being added
                    isMeaningful = proposedContent.trim().length > 0;
                } else {
                    // File exists, so it's potentially a MODIFY action
                    action = 'MODIFY';
                    if (current !== proposedContent) { // Only generate diff if content actually changed
                        diffStr = Diff.createPatch(relativePath, current, proposedContent, '', '', { context: 5 });
                        // Check if the diff contains actual changes (+ or - lines beyond header)
                        isMeaningful = diffStr.split('\n').slice(2).some(l => l.startsWith('+') || l.startsWith('-'));
                    } else {
                        // Content is identical, modification is not meaningful
                        isMeaningful = false;
                    }
                }
            }

            // Add to review data only if the action is considered meaningful
            if (isMeaningful) {
                reviewData.push({ filePath: relativePath, action, diff: diffStr });
            } else {
                console.log(chalk.gray(`  Skipping review for ${relativePath} - no effective changes detected.`));
            }
        }
        return reviewData; // Return the array of items for review
    }
    // --- presentChangesForReviewTUI (Handles TUI or fallback) ---
    private async presentChangesForReviewTUI(reviewData: ReviewDataItem[]): Promise<boolean> {
        if (reviewData.length === 0) {
            console.log(chalk.yellow("No changes to review."));
            return false; // No changes to apply
        }
        console.log(chalk.yellow("\nInitializing Review UI..."));
        try {
            const reviewUI = new ReviewUIManager(reviewData);
            return await reviewUI.run(); // Returns true if Apply, false if Reject
        } catch (tuiError) {
            console.error(chalk.red("Error displaying Review TUI:"), tuiError);
            console.log(chalk.yellow("Falling back to simple CLI confirmation."));
            // Fallback prompt using inquirer
            const { confirm } = await inquirer.prompt([{
                type: 'confirm',
                name: 'confirm',
                message: `Review UI failed. Apply ${reviewData.length} file change(s) based on prior summary?`,
                default: false // Default to not applying if UI fails
            }]);
            return confirm;
        }
    }

    // --- applyConsolidatedChanges (Unchanged) ---
    // --- applyConsolidatedChanges (Applies changes after review, includes Git check) ---
    private async applyConsolidatedChanges(finalStates: FinalFileStates, conversationFilePath: string): Promise<void> {
        console.log(chalk.blue("Checking Git status..."));
        try {
            // Check Git status before applying changes
            const { stdout, stderr } = await exec('git status --porcelain', { cwd: this.projectRoot });
            if (stderr) console.warn(chalk.yellow("Git status stderr:"), stderr); // Log stderr non-fatally
            const status = stdout.trim();
            if (status !== '') {
                // Git working directory is not clean
                console.error(chalk.red("\nError: Git working directory not clean:"));
                console.error(chalk.red(status));
                throw new Error('Git working directory not clean. Consolidation apply aborted to prevent data loss. Please commit or stash changes.');
            } else {
                console.log(chalk.green("Git status clean. Proceeding with file operations..."));
            }
        } catch (error: any) {
            // Handle errors during Git check (e.g., Git not installed, not a repo)
            console.error(chalk.red("\nError checking Git status:"), error.message || error);
            if (error.message?.includes('command not found') || error.code === 'ENOENT') {
                throw new Error('Git command not found. Please ensure Git is installed and in your system PATH.');
            } else if (error.stderr?.includes('not a git repository')) {
                throw new Error('Project directory is not a Git repository. Please initialize Git (`git init`).');
            }
            // Re-throw other Git errors
            throw new Error(`Failed to verify Git status. Error: ${error.message}`);
        }

        // Proceed with applying changes if Git check passed
        let success = 0, failed = 0, skipped = 0;
        const summary: string[] = []; // To log results

        for (const relativePath in finalStates) {
            const absolutePath = path.resolve(this.projectRoot, relativePath);
            const contentOrAction = finalStates[relativePath];

            try {
                if (contentOrAction === 'DELETE_CONFIRMED') {
                    try {
                        // Check if file exists before trying to delete
                        await this.fs.access(absolutePath);
                        await this.fs.deleteFile(absolutePath);
                        console.log(chalk.red(`  Deleted: ${relativePath}`));
                        summary.push(`Deleted: ${relativePath}`);
                        success++;
                    } catch (accessError) {
                        // If file doesn't exist, it's a skip, not an error
                        if ((accessError as NodeJS.ErrnoException).code === 'ENOENT') {
                            console.warn(chalk.yellow(`  Skipped delete (already gone): ${relativePath}`));
                            summary.push(`Skipped delete (already gone): ${relativePath}`);
                            skipped++;
                        } else {
                            // Rethrow unexpected errors during access/delete
                            throw accessError;
                        }
                    }
                } else { // Handle CREATE or MODIFY
                    // Ensure directory exists before writing the file
                    await this.fs.ensureDirExists(path.dirname(absolutePath));
                    // Write the file content (handles both create and modify)
                    await this.fs.writeFile(absolutePath, contentOrAction);
                    console.log(chalk.green(`  Written: ${relativePath}`));
                    summary.push(`Written: ${relativePath}`);
                    success++;
                }
            } catch (error) {
                // Catch errors during individual file operations
                console.error(chalk.red(`  Failed apply operation for ${relativePath}:`), error);
                summary.push(`Failed ${contentOrAction === 'DELETE_CONFIRMED' ? 'delete' : 'write'}: ${relativePath} - ${(error as Error).message}`);
                failed++;
            }
        }

        // Log the summary of operations
        console.log(chalk.blue("\n--- Consolidation Apply Summary ---"));
        summary.forEach(l => console.log(l.startsWith("Failed") ? chalk.red(`- ${l}`) : l.startsWith("Skipped") ? chalk.yellow(`- ${l}`) : chalk.green(`- ${l}`)));
        console.log(chalk.blue(`---------------------------------`));
        console.log(chalk.blue(`Applied: ${success}, Skipped/No-op: ${skipped}, Failed: ${failed}.`));

        // Log summary to conversation file
        try {
            const title = failed > 0 ? 'Consolidation Summary (with failures)' : 'Consolidation Summary';
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `${title}:\n${summary.join('\n')}` });
        } catch (logErr) {
            console.warn(chalk.yellow("Warning: Could not log apply summary to conversation file."), logErr);
        }

        // Throw an error if any operations failed to signal overall failure of the apply step
        if (failed > 0) {
            throw new Error(`Consolidation apply step completed with ${failed} failure(s). Please review the errors.`);
        }
    }
}
