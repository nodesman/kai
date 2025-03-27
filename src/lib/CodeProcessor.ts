// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
// Use correct type import from AIClient
import { AIClient, LogEntryData } from './AIClient';
import { encode as gpt3Encode } from 'gpt-3-encoder';
// Import Config class itself
import { Config } from "./Config";
import { UserInterface } from './UserInterface';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { toSnakeCase, countTokens } from './utils';
import FullScreenUI from "./iterativeDiff/FullScreenUI"; // Keep for TUI mode
import chalk from 'chalk';
import { ProjectContextBuilder } from './ProjectContextBuilder';
import * as Diff from 'diff'; // Import the diff library
import inquirer from 'inquirer'; // Import inquirer for the placeholder
import {
    Content,
    Part,
    Tool,
    FunctionDeclaration,
    GenerateContentRequest,
    GenerateContentResult,
    FunctionCallingMode,
    FinishReason,
    SchemaType, // *** Import SchemaType ***
    Schema, // Import Schema too!
    FunctionDeclarationSchemaProperty // Import FunctionDeclarationSchemaProperty as well!
} from "@google/generative-ai";
// --- Import for Git Check ---
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
const exec = promisify(execCb); // Promisify for async/await usage
// --- End Import ---

// Import the Review UI Manager and its types
import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager';

// --- Interfaces for Consolidation ---
interface ConsolidationAnalysis {
    operations: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE' }>;
    groups: string[][];
}

interface FinalFileStates {
    [filePath: string]: string | 'DELETE_CONFIRMED';
}
// --- End Consolidation Interfaces ---

const proposeCodeChangesDeclaration: FunctionDeclaration = {
    name: "propose_code_changes",
    description: "Submits a set of proposed changes to project files, including creation, modification, or deletion. Provide the full final content for created or modified files. Use relative paths.",
    parameters: {
        // @ts-ignore
        type: "object",
        properties: {
            changes: {
                // @ts-ignore
                type: "array",
                description: "A list of proposed file changes.",
                items: {
                    // @ts-ignore
                    type: "object",
                    required: ["filePath", "action"], // filePath and action are mandatory
                    properties: {
                        filePath: {
                            description: "The relative path to the file from the project root (e.g., 'src/components/Button.js'). Use forward slashes '/' as separators.",
                            // @ts-ignore
                            type: "string"
                        },
                        action: {
                            enum: ["CREATE", "MODIFY", "DELETE"],
                            description: "The operation to perform on the file.",
                            // @ts-ignore
                            type: "string"
                        },
                        content: {
                            description: "The *complete* final content of the file for CREATE or MODIFY actions. Omit for DELETE.",
                            // @ts-ignore
                            type: "string"
                        },
                    },
                },
            },
        },
        required: ["changes"], // The 'changes' array is mandatory
    },
};
// The Tool object to pass to the API
const proposeCodeChangesTool: Tool = {
    functionDeclarations: [proposeCodeChangesDeclaration],
};
class CodeProcessor {
    config: Config; // Use the Config class instance type
    fs: FileSystem;
    aiClient: AIClient;
    ui: UserInterface;
    projectRoot: string;
    private readonly CONSOLIDATE_COMMAND = '/consolidate';
    private contextBuilder: ProjectContextBuilder;

    constructor(config: Config) { // Accept Config class instance
        this.config = config;
        this.fs = new FileSystem();
        // AIClient constructor now handles creating both model instances
        this.aiClient = new AIClient(config);
        this.ui = new UserInterface(config);
        this.projectRoot = process.cwd();
        this.contextBuilder = new ProjectContextBuilder(this.fs, this.projectRoot, this.config); // Add this line
    }



    // --- buildContextString (Improved logging and token handling) ---
    async buildContextString(): Promise<{ context: string, tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context...'));
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const fileContents = await this.fs.readFileContents(filePaths);

        let contextString = "Code Base Context:\n";
        let currentTokenCount = countTokens(contextString);
        // Use max_prompt_tokens from config, apply safety margin
        const maxContextTokens = (this.config.gemini.max_prompt_tokens || 32000) * 0.6; // 60% safety margin
        let includedFiles = 0;
        let excludedFiles = 0;
        const sortedFilePaths = Object.keys(fileContents).sort();
        let estimatedTotalTokens = currentTokenCount; // Use a separate variable for estimated total

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) {
                console.log(chalk.gray(`  Skipping empty file: ${relativePath}`));
                excludedFiles++;
                continue;
            }
            content = this.optimizeWhitespace(content);
            if (!content) {
                console.log(chalk.gray(`  Skipping file with only whitespace: ${relativePath}`));
                excludedFiles++;
                continue;
            }

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;
            const fileTokens = countTokens(fileBlock);

            contextString += fileBlock;
            estimatedTotalTokens += fileTokens; // Update estimated total
            includedFiles++;
            console.log(chalk.dim(`  Included ${relativePath} (${fileTokens} tokens). Current total: ${estimatedTotalTokens.toFixed(0)}`));
        }
        console.log(chalk.blue(`Context built with ${includedFiles} files (${estimatedTotalTokens.toFixed(0)} tokens estimated). ${excludedFiles} files excluded/skipped. Max context set to ${maxContextTokens.toFixed(0)} tokens.`));
        // Recalculate final token count just to be sure, though estimation should be close
        const finalTokenCount = countTokens(contextString);
        console.log(chalk.blue(`Final calculated context token count: ${finalTokenCount}`));

        return { context: contextString, tokenCount: finalTokenCount };
    }


    optimizeWhitespace(code: string): string {
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\r\n/g, '\n');
        code = code.replace(/\n{3,}/g, '\n\n');
        code = code.trim();
        return code;
    }
    // --- End context building ---

    // --- startConversation (Unchanged) ---
    async startConversation(conversationName: string, isNew: boolean): Promise<void> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        let editorFilePath: string | null = null;
        let conversation: Conversation;

        let isFirstRequestInLoop = true; // Track first request

        try {
            if (!isNew) {
                const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
                conversation = Conversation.fromJsonlData(logData);
                console.log(`Loaded ${conversation.getMessages().length} messages for ${conversationName}.`);
            } else {
                conversation = new Conversation();
                console.log(`Starting new conversation: ${conversationName}`);
            }

            while (true) {
                const interactionResult = await this.ui.getPromptViaSublimeLoop(conversationName, conversation.getMessages());
                editorFilePath = interactionResult.editorFilePath;
                if (interactionResult.newPrompt === null) break;
                const userPrompt = interactionResult.newPrompt;

                // Handle /consolidate command trigger (unchanged)
                if (userPrompt.trim().toLowerCase() === this.CONSOLIDATE_COMMAND) {
                    console.log(chalk.yellow(`🚀 Intercepted ${this.CONSOLIDATE_COMMAND}. Starting consolidation process...`));
                    conversation.addMessage('user', userPrompt);
                    try { await this.aiClient.logConversation(conversationFilePath, { type: 'request', role: 'user', content: userPrompt }); }
                    catch (logErr) { console.error(chalk.red("Error logging consolidate command:"), logErr); }
                    await this.processConsolidationRequest(conversationName);
                    conversation.addMessage('system', `[Consolidation process triggered for '${conversationName}' has finished. See logs.]`);
                    continue; // Skip normal AI call
                }

                // Add user message (unchanged)
                conversation.addMessage('user', userPrompt);

                try {
                    const { context: currentContextString } = await this.contextBuilder.build();

                    // --- *** MODIFIED: Determine FLAG for Flash model *** ---
                    // Use Flash model if NOT the first request in the loop
                    const useFlash = !isFirstRequestInLoop;
                    // Log which model logic is triggering (optional)
                    if (useFlash) {
                        console.log(chalk.cyan(`Using subsequent model (Flash) for this request.`));
                    } else {
                        console.log(chalk.cyan(`Using initial model (Pro) for first request.`));
                    }
                    // --- End Model Determination ---

                    // --- *** MODIFIED: Pass useFlash FLAG to AIClient *** ---
                    await this.aiClient.getResponseFromAI(
                        conversation,
                        conversationFilePath,
                        currentContextString,
                        useFlash // Pass the boolean flag
                    );
                    // --- End Modification ---

                    // Mark subsequent requests after the first *successful* call
                    isFirstRequestInLoop = false;

                } catch (aiError) {
                    console.error(chalk.red("Error during AI interaction:"), aiError);
                    conversation.addMessage('system', `[Error occurred during AI request: ${(aiError as Error).message}. Please check logs. You can try again or exit.]`);
                }
            }
            console.log(`\nExiting conversation "${conversationName}".`);
        } catch (error) { // Catch block unchanged
            console.error(chalk.red(`\nAn unexpected error occurred in conversation "${conversationName}":`), error);
            if (conversationFilePath) {
                try { await this.aiClient.logConversation(conversationFilePath, { type: 'error', error: `CodeProcessor loop error: ${(error as Error).message}` }); }
                catch (logErr) { console.error(chalk.red("Additionally failed to log CodeProcessor error:"), logErr); }
            }
        } finally { // Finally block unchanged
            if (editorFilePath) {
                try {
                    await this.fs.access(editorFilePath);
                    await this.fs.deleteFile(editorFilePath);
                    console.log(`Cleaned up editor file: ${editorFilePath}`);
                } catch (cleanupError) {
                    if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                        console.warn(chalk.yellow(`\nWarning: Failed to clean up editor file ${editorFilePath}:`), cleanupError);
                    }
                }
            }
        }
    }

    // --- Consolidation Orchestration Method (Unchanged structure) ---
    async processConsolidationRequest(conversationName: string): Promise<void> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        let conversation: Conversation;
        const startMsg = `System: Starting AI-driven code consolidation for '${conversationName}'...`;
        console.log(chalk.blue(startMsg.replace('System: ', '')));

        try {
            // Load conversation and log start (unchanged)
            const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
            conversation = Conversation.fromJsonlData(logData);
            if (conversation.getMessages().length === 0) { console.warn(chalk.yellow("Conversation is empty, cannot consolidate.")); return; }
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: startMsg });

            console.log(chalk.cyan("  Fetching fresh codebase context..."));
            const { context: currentContextString } = await this.buildContextString();

            // --- Determine model for consolidation steps ---
            // Simple strategy: Use Pro for analysis (Step A), Flash for generation (Step B)
            const useFlashForAnalysis = false; // Use Pro for analysis
            const useFlashForGeneration = true; // Use Flash for generation
            const analysisModelName = useFlashForAnalysis ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            const generationModelName = useFlashForGeneration ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            console.log(chalk.cyan(`  (Using ${analysisModelName} for analysis, ${generationModelName} for generation)`));
            // ---

            console.log(chalk.cyan("\n  Step A: Analyzing conversation..."));
            const analysisResult = await this.analyzeConversationForChanges(conversation, currentContextString, useFlashForAnalysis);
            if (!analysisResult || analysisResult.operations.length === 0) {
                console.log(chalk.yellow("  Analysis complete: No file operations identified. Consolidation finished."));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found no intended operations.` });
                return;
            }
            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations across ${analysisResult.groups.length} generation group(s).`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found ${analysisResult.operations.length} ops in ${analysisResult.groups.length} groups...` });

            console.log(chalk.cyan("\n  Step B: Generating final file states..."));
            const finalStates = await this.generateFinalFileContents(conversation, currentContextString, analysisResult, useFlashForGeneration);
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
            const reviewUI = new ReviewUIManager(reviewData);
            const applyChanges = await reviewUI.run();

            if (applyChanges) { // Step D unchanged
                console.log(chalk.cyan("\n  Step D: Applying approved changes..."));
                await this.applyConsolidatedChanges(finalStates, conversationFilePath);
            } else { // Rejection logging unchanged
                const msg = `System: Consolidation aborted by user. No changes applied.`;
                console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg });
            }
        } catch (error) { // Error handling unchanged (uses 'error' property correctly)
            console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation: ${(error as Error).message}. See console for details.`;
            try {
                // Ensure the payload matches LogEntryData
                const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                await this.aiClient.logConversation(conversationFilePath, logPayload);
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
            }
        }
    }

    // --- Step A Implementation (Unchanged) ---
    private async analyzeConversationForChanges(
        conversation: Conversation,
        codeContext: string,
        useFlashModel: boolean = false // Use flag instead of name
    ): Promise<ConsolidationAnalysis | null> {
        const analysisPrompt = `CONTEXT:\nYou are an expert AI analyzing a software development conversation...\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map(m => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nBased *only* on the conversation history and the provided codebase context, determine the final intended operations (CREATE, MODIFY, DELETE) for each relevant file path (relative to the project root). Resolve contradictions based on conversational flow (later messages override earlier ones unless stated otherwise).\n\nAlso, group the files needing CREATE or MODIFY into logical sets for generating their final content. Aim to minimize subsequent requests. Files marked for DELETE do not need grouping.\n\nOUTPUT FORMAT:\nRespond *only* with a single JSON object matching this structure:\n\`\`\`json\n{\n  "operations": [\n    { "filePath": "path/relative/to/root.ext", "action": "CREATE" | "MODIFY" | "DELETE" }\n  ],\n  "groups": [\n    ["path/to/file1.ext", "path/to/file2.ext"],\n    ["path/to/another_file.ext"]\n  ]\n}\n\`\`\`\nIf no operations are intended, return \`{ "operations": [], "groups": [] }\`. Ensure filePaths are relative.`;
        try {
            // --- *** MODIFIED: Pass useFlashModel flag to AIClient *** ---
            const responseText = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: analysisPrompt }],
                useFlashModel // Pass the boolean flag
            );
            // --- End Modification ---
            // Parsing logic unchanged
            const jsonString = responseText.trim().replace(/^```json\s*/, '').replace(/```$/, '');
            const jsonResponse = JSON.parse(jsonString);
            if (jsonResponse && Array.isArray(jsonResponse.operations) && Array.isArray(jsonResponse.groups)) {
                jsonResponse.operations.forEach((op: any) => { if (op.filePath) op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, ''); });
                jsonResponse.groups.forEach((group: string[]) => { for (let i = 0; i < group.length; i++) group[i] = path.normalize(group[i]).replace(/^[\\\/]+|[\\\/]+$/g, ''); });
                return jsonResponse as ConsolidationAnalysis;
            } else { throw new Error("Invalid JSON structure from analysis AI."); }
        } catch (e) { throw new Error(`AI analysis step failed. Error: ${(e as Error).message}`); }
    }

    // --- Step B Implementation (MODIFIED: Accept useFlashModel flag) ---
    private async generateFinalFileContents(
        conversation: Conversation,
        codeContext: string,
        analysisResult: ConsolidationAnalysis,
        useFlashModel: boolean = false
    ): Promise<FinalFileStates> {
        const allFinalStates: FinalFileStates = {};

        // --- Prepare the Prompt ---
        // Combine all files needing generation into a single list for the prompt.
        const filesToGenerate = analysisResult.groups.flat();
        if (filesToGenerate.length === 0 && analysisResult.operations.some(op => op.action === 'DELETE')) {
            // Only DELETE operations, no generation needed.
        } else if (filesToGenerate.length === 0) {
            console.log(chalk.yellow("    No files identified for CREATE or MODIFY in analysis. Skipping generation call."));
            // Still need to handle deletes later.
        } else {
            console.log(chalk.cyan(`    Requesting generation for files: [${filesToGenerate.join(', ')}] via function call...`));

            // Adjust prompt to instruct the use of the function
            const generationPrompt = `CONTEXT:\nYou are an expert AI assisting with code generation based on a conversation history and current codebase.\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map(m => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nBased *only* on the conversation history and the provided codebase context, determine the final state (content or deletion) for all relevant files.\n\nCall the 'propose_code_changes' function with an array of changes. For each file, provide:\n1.  'filePath': The relative path.\n2.  'action': Either 'CREATE', 'MODIFY', or 'DELETE'.\n3.  'content': The *complete, final file content* ONLY if the action is 'CREATE' or 'MODIFY'. Omit 'content' if the action is 'DELETE'.\n\nEnsure you include changes for ALL files that were modified, created, or deleted based on the conversation's final intent. Focus on these files specifically:\n${filesToGenerate.map(f => `- ${f}`).join('\n')}\n(Also include any other files whose final state is dictated by the conversation, even if not in the list above).`;

            // --- Construct the API Request ---
            const historyForGeneration: Content[] = [
                // We could potentially include some history here, but for generation,
                // the full context and conversation in the *user* prompt is often sufficient.
                // Example: ...this.aiClient.convertToGeminiConversation(conversation.getMessages()).slice(-5) // Last 5 turns
            ];
            const request: GenerateContentRequest = {
                // Combine history and the main prompt
                contents: [
                    ...historyForGeneration,
                    { role: "user", parts: [{ text: generationPrompt }] }
                ],
                tools: [proposeCodeChangesTool], // Pass the defined tool
                toolConfig: {
                    // Force the model to call *a* function. Could be ANY if fallback is desired.
                    functionCallingConfig: { mode: FunctionCallingMode.ANY } // Or REQUIRED
                }
            };

            // --- Make the API Call ---
            let result: GenerateContentResult | null = null;
            try {
                result = await this.aiClient.generateContent(request, useFlashModel);
            } catch (error) {
                // Handle API call errors (network, rate limits, etc., thrown by AIClient)
                throw new Error(`AI generation API call failed. Error: ${(error as Error).message}`);
            }

            // --- Process the Response ---
            const response = result?.response;
            const candidate = response?.candidates?.[0];
            const functionCall = candidate?.content?.parts?.find(part => !!part.functionCall)?.functionCall;

            if (functionCall && functionCall.name === proposeCodeChangesDeclaration.name) {
                console.log(chalk.green(`    Successfully received function call '${functionCall.name}'.`));
                const args = functionCall.args as { changes: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE'; content?: string }> };

                if (!args || !Array.isArray(args.changes)) {
                    throw new Error(`Function call '${functionCall.name}' returned invalid or missing 'changes' argument.`);
                }

                // --- Populate finalStates from Function Call Arguments ---
                for (const change of args.changes) {
                    if (!change.filePath || !change.action) {
                        console.warn(chalk.yellow(`    Skipping invalid change item from function call: ${JSON.stringify(change)}`));
                        continue;
                    }
                    const normalizedPath = path.normalize(change.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');

                    if (change.action === 'CREATE' || change.action === 'MODIFY') {
                        if (typeof change.content !== 'string') {
                            // Allow empty string for content, but not null/undefined
                            console.warn(chalk.yellow(`    Missing or invalid 'content' for ${change.action} action on ${normalizedPath}. Treating as empty file.`));
                            allFinalStates[normalizedPath] = ""; // Default to empty string if content missing
                        } else {
                            allFinalStates[normalizedPath] = change.content;
                        }
                        console.log(chalk.dim(`      Processed ${change.action} for ${normalizedPath} (Content length: ${change.content?.length ?? 0})`));
                    } else if (change.action === 'DELETE') {
                        allFinalStates[normalizedPath] = 'DELETE_CONFIRMED';
                        console.log(chalk.dim(`      Processed DELETE for ${normalizedPath}`));
                    } else {
                        console.warn(chalk.yellow(`    Skipping change with unknown action '${change.action}' for ${normalizedPath}`));
                    }
                }
            } else {
                // --- Handle cases where the function wasn't called ---
                const finishReason = candidate?.finishReason;
                const textResponse = candidate?.content?.parts?.find(part => !!part.text)?.text;

                let errorMsg = `AI generation step failed: Model did not call the required function '${proposeCodeChangesDeclaration.name}'.`;
                if (finishReason && finishReason !== FinishReason.STOP) {
                    errorMsg += ` Finish Reason: ${finishReason}.`;
                    if (finishReason === FinishReason.SAFETY) {
                        errorMsg += ` Safety Ratings: ${JSON.stringify(candidate?.safetyRatings)}`;
                    }
                }
                if (textResponse) {
                    errorMsg += `\nModel Response Text (instead of function call):\n---\n${textResponse.substring(0, 500)}${textResponse.length > 500 ? '...' : ''}\n---`;
                    console.error(chalk.red(errorMsg));
                    // Decide if you want to retry or just fail here
                    // throw new Error(errorMsg); // Throw error to halt consolidation
                    // OR you could try parsing the text response for JSON as a fallback, but that defeats the purpose of function calling.
                } else {
                    console.error(chalk.red(errorMsg + " No text fallback response provided either."));
                    // throw new Error(errorMsg); // Throw error
                }
                // For now, we'll throw the error to indicate failure.
                throw new Error(errorMsg);
            }
        } // End of else block for filesToGenerate.length > 0

        // --- Add DELETE confirmations from Analysis (Fallback/Sanity Check) ---
        // This ensures deletes identified in Step A are still marked, even if the LLM
        // forgets to include them in the function call (though ideally it shouldn't).
        const deleteOps = analysisResult.operations.filter(op => op.action === 'DELETE');
        for (const op of deleteOps) {
            const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
            if (!(normalizedPath in allFinalStates)) {
                console.warn(chalk.yellow(`    Note: Adding DELETE for ${normalizedPath} based on analysis (was missing from function call response).`));
                allFinalStates[normalizedPath] = 'DELETE_CONFIRMED';
            } else if (allFinalStates[normalizedPath] !== 'DELETE_CONFIRMED') {
                console.warn(chalk.yellow(`    Warning: ${normalizedPath} was marked DELETE in analysis but function call provided content/modification. Prioritizing function call result.`));
                // Keep the state from the function call if it conflicts
            }
        }
        return allFinalStates;
    }
    // --- Step C - Prepare Data (Unchanged) ---
    private async prepareReviewData(finalStates: FinalFileStates): Promise<ReviewDataItem[]> {
        const reviewData: ReviewDataItem[] = [];
        for (const relativePath in finalStates) {
            const proposed = finalStates[relativePath];
            const absolutePath = path.resolve(this.projectRoot, relativePath);
            let current: string | null = null;
            let action: ReviewAction = 'MODIFY';
            try { current = await this.fs.readFile(absolutePath); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            let diffStr = '';
            if (proposed === 'DELETE_CONFIRMED') {
                action = 'DELETE';
                if (current !== null) diffStr = Diff.createPatch(relativePath, current, '', '', '', { context: 5 });
                else continue;
            } else if (current === null) {
                action = 'CREATE';
                diffStr = Diff.createPatch(relativePath, '', proposed, '', '', { context: 5 });
            } else {
                action = 'MODIFY';
                diffStr = Diff.createPatch(relativePath, current, proposed, '', '', { context: 5 });
            }
            const isMeaningful = diffStr.split('\n').slice(2).some(l => l.startsWith('+') || l.startsWith('-'));
            if (action === 'CREATE' || action === 'DELETE' || isMeaningful) reviewData.push({ filePath: relativePath, action, diff: diffStr });
            else console.log(chalk.gray(`  Skipping review for ${relativePath} - no effective changes.`));
        }
        return reviewData;
    }

    // --- Step C - TUI/Review (Unchanged) ---
    private async presentChangesForReviewTUI(reviewData: ReviewDataItem[]): Promise<boolean> {
        console.log(chalk.yellow("\nInitializing Review UI..."));
        try {
            const reviewUI = new ReviewUIManager(reviewData);
            return await reviewUI.run();
        } catch (tuiError) {
            console.error(chalk.red("Error displaying Review TUI:"), tuiError);
            console.log(chalk.yellow("Falling back to simple CLI confirmation."));
            const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Review UI failed. Apply ${reviewData.length} changes based on console summary?`, default: false }]);
            return confirm;
        }
    }

    // --- Step D Implementation (Apply Changes with Git Check - Unchanged) ---
    private async applyConsolidatedChanges(finalStates: FinalFileStates, conversationFilePath: string): Promise<void> {
        console.log(chalk.blue("Checking Git status..."));
        try {
            const { stdout, stderr } = await exec('git status --porcelain', { cwd: this.projectRoot });
            if (stderr) console.warn(chalk.yellow("Git status stderr:"), stderr);
            const status = stdout.trim();
            if (status !== '') {
                console.error(chalk.red("\nError: Git working directory not clean:"));
                console.error(chalk.red(status));
                throw new Error('Git working directory not clean. Aborted.');
            } else console.log(chalk.green("Git status clean. Proceeding..."));
        } catch (error: any) { // Error handling unchanged
            console.error(chalk.red("\nError checking Git status:"), error.message || error);
            if (error.message?.includes('command not found') || error.code === 'ENOENT') throw new Error('Git command not found.');
            else if (error.stderr?.includes('not a git repository')) throw new Error('Project directory is not a Git repository.');
            throw new Error(`Failed to verify Git status. Error: ${error.message}`);
        }

        // File operations logic unchanged
        let success = 0, failed = 0, skipped = 0;
        const summary: string[] = [];
        for (const relativePath in finalStates) {
            const absolutePath = path.resolve(this.projectRoot, relativePath);
            const contentOrAction = finalStates[relativePath];
            try {
                if (contentOrAction === 'DELETE_CONFIRMED') {
                    try {
                        await this.fs.access(absolutePath);
                        await this.fs.deleteFile(absolutePath);
                        console.log(chalk.red(`  Deleted: ${relativePath}`));
                        summary.push(`Deleted: ${relativePath}`); success++;
                    } catch (accessError) {
                        if ((accessError as NodeJS.ErrnoException).code === 'ENOENT') {
                            console.warn(chalk.yellow(`  Skipped delete (already gone): ${relativePath}`));
                            summary.push(`Skipped delete (already gone): ${relativePath}`); skipped++;
                        } else throw accessError;
                    }
                } else {
                    await this.fs.ensureDirExists(path.dirname(absolutePath));
                    await this.fs.writeFile(absolutePath, contentOrAction);
                    console.log(chalk.green(`  Written: ${relativePath}`));
                    summary.push(`Written: ${relativePath}`); success++;
                }
            } catch (error) { // Error logging unchanged
                console.error(chalk.red(`  Failed apply for ${relativePath}:`), error);
                summary.push(`Failed ${contentOrAction === 'DELETE_CONFIRMED' ? 'delete' : 'write'}: ${relativePath} - ${(error as Error).message}`);
                failed++;
            }
        }

        // Summary logging unchanged
        console.log(chalk.blue("\n--- Consolidation Apply Summary ---"));
        summary.forEach(l => console.log(l.startsWith("Failed") ? chalk.red(`- ${l}`) : l.startsWith("Skipped") ? chalk.yellow(`- ${l}`) : chalk.green(`- ${l}`)));
        console.log(chalk.blue(`---------------------------------`));
        console.log(chalk.blue(`Applied: ${success}, Skipped/No-op: ${skipped}, Failed: ${failed}.`));
        try {
            const title = failed > 0 ? 'Consolidation Summary (with failures)' : 'Consolidation Summary';
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `${title}:\n${summary.join('\n')}` });
        } catch (logErr) { console.warn(chalk.yellow("Warning: Could not log apply summary."), logErr); }
    }

    // --- TUI Mode (Unchanged) ---
    async startCodeChangeTUI(): Promise<void> {
        console.log("Initializing Code Change TUI...");
        const fullScreenUI = new FullScreenUI(); // Assuming FullScreenUI exists
        fullScreenUI.show();
        return new Promise(() => {});
    }
}

export { CodeProcessor };