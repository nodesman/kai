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
    Content, Part, Tool, FunctionDeclaration, GenerateContentRequest,
    GenerateContentResult, FunctionCallingMode, FinishReason, SchemaType, Schema,
    FunctionDeclarationSchemaProperty
} from "@google/generative-ai";

const exec = promisify(execCb);

// --- Interfaces (Copied/Moved from CodeProcessor) ---
interface ConsolidationAnalysis {
    operations: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE' }>;
    groups: string[][];
}

interface FinalFileStates {
    [filePath: string]: string | 'DELETE_CONFIRMED';
}
// --- End Interfaces ---

// --- Tool Definition (Copied/Moved from CodeProcessor) ---
const proposeCodeChangesDeclaration: FunctionDeclaration = {
    name: "propose_code_changes",
    description: "Submits a set of proposed changes to project files, including creation, modification, or deletion. Provide the full final content for created or modified files. Use relative paths.",
    parameters: {
        // @ts-ignore - Bypassing stricter schema checks for now
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
const proposeCodeChangesTool: Tool = {
    functionDeclarations: [proposeCodeChangesDeclaration],
};
// --- End Tool Definition ---

export class ConsolidationService {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;
    // No direct access to contextBuilder needed if context is passed in
    // No direct access to ui needed

    constructor(config: Config, fileSystem: FileSystem, aiClient: AIClient, projectRoot: string) {
        this.config = config;
        this.fs = fileSystem;
        this.aiClient = aiClient;
        this.projectRoot = projectRoot;
    }

    /**
     * Orchestrates the entire consolidation process.
     * @param conversationName The name of the conversation.
     * @param conversation The Conversation object.
     * @param currentContextString The current codebase context string.
     * @param conversationFilePath The absolute path to the conversation log file.
     */
    async process(
        conversationName: string,
        conversation: Conversation,
        currentContextString: string, // Receive context as argument
        conversationFilePath: string
    ): Promise<void> {
        const startMsg = `System: Starting AI-driven code consolidation for '${conversationName}'...`;
        console.log(chalk.blue(startMsg.replace('System: ', '')));
        // Use the passed aiClient instance for logging
        await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: startMsg });

        try {
            // --- Determine model for consolidation steps ---
            const useFlashForAnalysis = false; // Use Pro for analysis
            const useFlashForGeneration = true; // Use Flash for generation
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

            console.log(chalk.cyan("\n  Step B: Generating final file states..."));
            const finalStates = await this.generateFinalFileContents(conversation, currentContextString, analysisResult, conversationFilePath, useFlashForGeneration, generationModelName);
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
            const applyChanges = await this.presentChangesForReviewTUI(reviewData); // Use the moved method

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
            // Re-throw or handle as appropriate for the caller (CodeProcessor/main)
            throw error;
        }
    }

    // --- Moved Private Helper Methods ---

    private async analyzeConversationForChanges(
        conversation: Conversation,
        codeContext: string,
        conversationFilePath: string, // ADDED: Logging
        useFlashModel: boolean,
        modelName: string // ADDED: Logging
    ): Promise<ConsolidationAnalysis | null> {
        const analysisPrompt = `CONTEXT:\nYou are an expert AI analyzing a software development conversation...\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map((m: Message) => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nBased *only* on the conversation history and the provided codebase context, determine the final intended operations (CREATE, MODIFY, DELETE) for each relevant file path (relative to the project root). Resolve contradictions based on conversational flow (later messages override earlier ones unless stated otherwise).\n\nAlso, group the files needing CREATE or MODIFY into logical sets for generating their final content. Aim to minimize subsequent requests. Files marked for DELETE do not need grouping.\n\nOUTPUT FORMAT:\nRespond *only* with a single JSON object matching this structure:\n\`\`\`json\n{\n  "operations": [\n    { "filePath": "path/relative/to/root.ext", "action": "CREATE" | "MODIFY" | "DELETE" }\n  ],\n  "groups": [\n    ["path/to/file1.ext", "path/to/file2.ext"],\n    ["path/to/another_file.ext"]\n  ]\n}\n\`\`\`\nIf no operations are intended, return \`{ "operations": [], "groups": [] }\`. Ensure filePaths are relative.`;
        try {
            const responseText = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: analysisPrompt }],
                useFlashModel
            );
            // Parsing logic
            const jsonString = responseText.trim().replace(/^```json\s*/, '').replace(/```$/, '');
            const jsonResponse = JSON.parse(jsonString);
            if (jsonResponse && Array.isArray(jsonResponse.operations) && Array.isArray(jsonResponse.groups)) {
                jsonResponse.operations.forEach((op: any) => { if (op.filePath) op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, ''); });
                jsonResponse.groups.forEach((group: string[]) => { for (let i = 0; i < group.length; i++) group[i] = path.normalize(group[i]).replace(/^[\\\/]+|[\\\/]+$/g, ''); });
                return jsonResponse as ConsolidationAnalysis;
            } else { throw new Error("Invalid JSON structure from analysis AI."); }
        } catch (e) {
            const errorMsg = `AI analysis step failed (using ${modelName}). Error: ${(e as Error).message}`;
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            throw new Error(errorMsg); // Re-throw wrapped error
        }

    }

    private async generateFinalFileContents(
        conversation: Conversation,
        codeContext: string,
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string, // ADDED: Logging
        useFlashModel: boolean,
        modelName: string // ADDED: Logging
    ): Promise<FinalFileStates> {
        const allFinalStates: FinalFileStates = {};

        // --- Prepare the Prompt ---
        // Combine all files needing generation into a single list for the prompt.
        const filesToGenerate = analysisResult.groups.flat();
        if (filesToGenerate.length === 0 && analysisResult.operations.some((op: { action: string; }) => op.action === 'DELETE')) {
            // Only DELETE operations, no generation needed.
        } else if (filesToGenerate.length === 0) {
            console.log(chalk.yellow("    No files identified for CREATE or MODIFY in analysis. Skipping generation call."));
            // Still need to handle deletes later.
        } else {
            console.log(chalk.cyan(`    Requesting generation for files: [${filesToGenerate.join(', ')}] via function call...`));

            // Adjust prompt to instruct the use of the function
            const generationPrompt = `CONTEXT:\nYou are an expert AI assisting with code generation based on a conversation history and current codebase.\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map((m: Message) => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nBased *only* on the conversation history and the provided codebase context, determine the final state (content or deletion) for all relevant files.\n\nCall the 'propose_code_changes' function with an array of changes. For each file, provide:\n1.  'filePath': The relative path.\n2.  'action': Either 'CREATE', 'MODIFY', or 'DELETE'.\n3.  'content': The *complete, final file content* ONLY if the action is 'CREATE' or 'MODIFY'. Omit 'content' if the action is 'DELETE'.\n\nEnsure you include changes for ALL files that were modified, created, or deleted based on the conversation's final intent. Focus on these files specifically:\n${filesToGenerate.map((f: any) => `- ${f}`).join('\n')}\n(Also include any other files whose final state is dictated by the conversation, even if not in the list above).`;

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
                const errorMsg = `AI generation API call failed (using ${modelName}). Error: ${(error as Error).message}`;
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
                throw new Error(errorMsg); // Re-throw wrapped error
            }

            // --- Process the Response ---
            const response = result?.response;
            const candidate = response?.candidates?.[0];
            const functionCall = candidate?.content?.parts?.find(part => !!part.functionCall)?.functionCall;

            if (functionCall && functionCall.name === proposeCodeChangesDeclaration.name) {
                console.log(chalk.green(`    Successfully received function call '${functionCall.name}'.`));
                const args = functionCall.args as { changes: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE'; content?: string }> };

                if (!args || !Array.isArray(args.changes)) {
                    const errMsg = `Function call '${functionCall.name}' returned invalid or missing 'changes' argument.`;
                    await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errMsg });
                    throw new Error(errMsg);
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
        const deleteOps = analysisResult.operations.filter((op: { action: string; }) => op.action === 'DELETE');
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

    private async prepareReviewData(finalStates: FinalFileStates): Promise<ReviewDataItem[]> {
        // ... implementation moved from CodeProcessor ...
        // Replace `this.fs` calls with `this.fs`
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

    private async presentChangesForReviewTUI(reviewData: ReviewDataItem[]): Promise<boolean> {
        // ... implementation moved from CodeProcessor ...
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

    private async applyConsolidatedChanges(finalStates: FinalFileStates, conversationFilePath: string): Promise<void> {
        // ... implementation moved from CodeProcessor ...
        // Replace `this.fs` and `this.aiClient` calls with `this.fs` and `this.aiClient`
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
}