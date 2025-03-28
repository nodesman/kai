// src/lib/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
import * as Diff from 'diff'; // Still needed for prepareReviewData
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import inquirer from 'inquirer'; // Keep for fallback in review TUI failure
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient'; // Correct import
import { Config } from './Config';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager';
// Removed imports related to Function Calling tools as they are no longer used here
// e.g., Tool, FunctionDeclaration, GenerateContentRequest, FunctionCallingMode etc.

const exec = promisify(execCb);

// --- Interfaces (Unchanged) ---
interface ConsolidationAnalysis {
    operations: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE' }>;
    // Groups are less critical now but kept in analysis output for potential future use
    groups: string[][];
}

interface FinalFileStates {
    // Key is the relative file path
    // Value is the FULL final content string OR 'DELETE_CONFIRMED'
    [filePath: string]: string | 'DELETE_CONFIRMED';
}
// --- End Interfaces ---

// --- REMOVED Tool Definitions ---
// proposeCodeChangesDeclaration, proposeCodeChangesTool
// provideSingleFileContentDeclaration, provideSingleFileContentTool
// --- END REMOVED Tool Definitions ---

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
            const useFlashForIndividualGeneration = false; // Default to Pro for generating full file content
            const analysisModelName = useFlashForAnalysis ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            const generationModelName = useFlashForIndividualGeneration ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            console.log(chalk.cyan(`  (Using ${analysisModelName} for analysis, ${generationModelName} for individual file generation)`));
            // ---

            console.log(chalk.cyan("\n  Step A: Analyzing conversation..."));
            const analysisResult = await this.analyzeConversationForChanges(conversation, currentContextString, conversationFilePath, useFlashForAnalysis, analysisModelName);
            if (!analysisResult || analysisResult.operations.length === 0) {
                console.log(chalk.yellow("  Analysis complete: No file operations identified. Consolidation finished."));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found no intended operations.` });
                return;
            }
            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations.`)); // Simplified log
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found ${analysisResult.operations.length} ops...` }); // Simplified log

            // *** UPDATED Step B: Call the NEW generation method ***
            console.log(chalk.cyan("\n  Step B: Generating final file states individually..."));
            const finalStates = await this.generateIndividualFileContents(
                conversation,
                currentContextString, // Pass context for individual prompts
                analysisResult,
                conversationFilePath,
                useFlashForIndividualGeneration, // Pass the flag
                generationModelName // Pass the model name for logging
            );
            // *** END UPDATED Step B ***

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

    // --- REMOVED refineFileContentsWithFlash method ---

    // --- analyzeConversationForChanges (Unchanged - Relies on text generation) ---
    private async analyzeConversationForChanges(
        conversation: Conversation,
        codeContext: string,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string
    ): Promise<ConsolidationAnalysis | null> {
        const analysisPrompt = `CONTEXT:\nYou are an expert AI analyzing a software development conversation...\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map((m: Message) => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nBased *only* on the conversation history and the provided codebase context, determine the final intended operations (CREATE, MODIFY, DELETE) for each relevant file path (relative to the project root). Resolve contradictions based on conversational flow (later messages override earlier ones unless stated otherwise).\n\nOUTPUT FORMAT:\nRespond *only* with a single JSON object matching this structure:\n\`\`\`json\n{\n  "operations": [\n    { "filePath": "path/relative/to/root.ext", "action": "CREATE" | "MODIFY" | "DELETE" }\n  ],\n  "groups": [] // Keep groups field for structure, but it's ignored in this milestone's generation step\n}\n\`\`\`\nIf no operations are intended, return \`{ "operations": [], "groups": [] }\`. Ensure filePaths are relative.`;
        try {
            const responseText = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: analysisPrompt }],
                useFlashModel // Use the passed flag
            );
            // Basic cleanup attempt for markdown fences
            const jsonString = responseText.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
            const jsonResponse = JSON.parse(jsonString);

            // Validate the structure
            if (jsonResponse && Array.isArray(jsonResponse.operations)) {
                // Ensure groups array exists, even if empty
                if (!Array.isArray(jsonResponse.groups)) {
                    jsonResponse.groups = [];
                }
                // Normalize paths immediately after parsing
                jsonResponse.operations.forEach((op: any) => {
                    if (op.filePath && typeof op.filePath === 'string') {
                        op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                    } else {
                        // Throw error if filePath is missing or not a string
                        throw new Error(`Invalid or missing 'filePath' in analysis operation: ${JSON.stringify(op)}`);
                    }
                    if (!op.action || !['CREATE', 'MODIFY', 'DELETE'].includes(op.action)) {
                        throw new Error(`Invalid or missing 'action' in analysis operation: ${JSON.stringify(op)}`);
                    }
                });
                // We don't need to normalize paths in groups as they are ignored now.

                return jsonResponse as ConsolidationAnalysis;
            } else {
                throw new Error("Invalid JSON structure received from analysis AI.");
            }
        } catch (e) {
            const errorMsg = `AI analysis step failed (using ${modelName}). Error parsing response or invalid structure: ${(e as Error).message}`;
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            // Log the raw response for debugging if parsing failed
            if (e instanceof SyntaxError) {
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: `Raw Analysis Response: ${e.message.substring(0, 500)}...` });
            }
            throw new Error(errorMsg); // Re-throw after logging
        }
    }

    // --- *** NEW: generateIndividualFileContents *** ---
    // Replaces the old generateFinalFileContents using function calling
    private async generateIndividualFileContents(
        conversation: Conversation,
        codeContext: string, // Pass full context, prompt will handle it
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string // For logging which model is used
    ): Promise<FinalFileStates> {
        const finalStates: FinalFileStates = {};

        // 1. Identify files needing generation (CREATE/MODIFY)
        const filesToGenerate = analysisResult.operations
            .filter(op => op.action === 'CREATE' || op.action === 'MODIFY')
            .map(op => op.filePath); // Get just the paths

        if (filesToGenerate.length === 0) {
            console.log(chalk.yellow("    No files require content generation based on analysis."));
            // Proceed to handle only DELETES from analysis
        } else {
            console.log(chalk.cyan(`    Generating content for ${filesToGenerate.length} file(s) individually using ${modelName}...`));

            // 2. Loop and generate content for each file
            for (const filePath of filesToGenerate) {
                const normalizedPath = path.normalize(filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                console.log(chalk.cyan(`      Generating content for: ${normalizedPath}`));

                try {
                    // Optional: Read current content for context (handle ENOENT for CREATE)
                    let currentContent: string | null = null;
                    try {
                        currentContent = await this.fs.readFile(path.resolve(this.projectRoot, normalizedPath));
                    } catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
                    }

                    // Construct the focused prompt for THIS file
                    const individualPrompt = this._constructIndividualFileGenerationPrompt(
                        conversation,
                        codeContext, // Pass full context, let model use what's relevant
                        normalizedPath,
                        currentContent
                    );

                    // Call AI using getResponseTextFromAI
                    const responseTextRaw = await this.aiClient.getResponseTextFromAI(
                        [{ role: 'user', content: individualPrompt }],
                        useFlashModel
                    );

                    // Attempt to clean up markdown fences, if the model adds them unexpectedly
                    let responseTextClean = responseTextRaw.trim();
                    const startsWithFence = responseTextClean.match(/^```(?:[\w-]+)?\s*\n/); // Match ```, optional language, newline
                    const endsWithFence = responseTextClean.endsWith('\n```');

                    if (startsWithFence && endsWithFence) {
                        console.warn(chalk.yellow(`      Note: Removing markdown fences from AI response for ${normalizedPath}`));
                        responseTextClean = responseTextClean.substring(startsWithFence[0].length, responseTextClean.length - 4).trim();
                    } else if (startsWithFence || endsWithFence) {
                        // Only one fence found, could be risky to strip, log a warning
                        console.warn(chalk.yellow(`      Warning: Found partial markdown fence in AI response for ${normalizedPath}. Using content as is.`));
                    }

                    // Check for DELETE instruction
                    if (responseTextClean === "DELETE_FILE") {
                        finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                        console.log(chalk.yellow(`      AI suggested DELETE for ${normalizedPath}. Marked for deletion.`));
                        await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: AI suggested DELETE for ${normalizedPath} during individual generation.` });

                    } else {
                        // Store the full generated content
                        finalStates[normalizedPath] = responseTextClean;
                        console.log(chalk.green(`      Successfully generated content for ${normalizedPath} (Length: ${responseTextClean.length})`));
                    }

                } catch (error) {
                    const errorMsg = `Failed to generate content for ${normalizedPath} using ${modelName}. Error: ${(error as Error).message}`;
                    console.error(chalk.red(`      ${errorMsg}`));
                    await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
                    // Decide how to handle: skip file, add error state? Skipping for now.
                    // You could add: finalStates[normalizedPath] = `ERROR: Generation failed - ${(error as Error).message}`;
                }
            }
        }

        // 3. Add DELETE confirmations from Analysis (Important Fallback/Primary)
        // This ensures deletes identified in Step A are always marked, even if generation wasn't run or AI suggested differently.
        for (const op of analysisResult.operations) {
            if (op.action === 'DELETE') {
                const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                if (!(normalizedPath in finalStates)) {
                    // Add if not already processed (e.g., by AI suggesting delete)
                    console.log(chalk.dim(`      Marking DELETE for ${normalizedPath} based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                } else if (finalStates[normalizedPath] !== 'DELETE_CONFIRMED') {
                    // Log conflict but prioritize analysis for DELETE actions in this case
                    console.warn(chalk.yellow(`      Warning: ${normalizedPath} was marked DELETE in analysis, but generation step provided content. Prioritizing DELETE based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED'; // Override generation result
                    await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Overriding generated content for ${normalizedPath} with DELETE based on analysis.` });
                }
            }
        }

        return finalStates;
    }

    // Helper to construct the prompt for individual file generation
    private _constructIndividualFileGenerationPrompt(
        conversation: Conversation,
        codeContext: string,
        filePath: string,
        currentContent: string | null
    ): string {
        // Limit context string size if necessary, although passing full might be fine for powerful models
        // Re-evaluate if context size becomes an issue for individual calls
        // const maxContextChars = 30000;
        // const truncatedContext = codeContext.length > maxContextChars
        //     ? codeContext.substring(0, maxContextChars) + "\n... (Context Truncated)"
        //     : codeContext;

        const historyString = conversation.getMessages()
            .map((m: Message) => `${m.role}:\n${m.content}\n---\n`)
            .join('');

        return `CONTEXT:
You are an expert AI assisting with code generation based on a conversation.
CODEBASE CONTEXT:
${codeContext}
---
CONVERSATION HISTORY:
${historyString}
---
CURRENT FILE CONTENT for '${filePath}' (if it exists):
${currentContent === null ? '(File does not exist - generate content for creation)' : `\`\`\`\n${currentContent}\n\`\`\``}
---
TASK:
Based *only* on the conversation history and provided context/current content, generate the **complete and final content** for the single file specified below:
File Path: '${filePath}'

Respond ONLY with the raw file content for '${filePath}'.
Do NOT include explanations, markdown code fences (\`\`\`), file path headers, or any other text outside the file content itself.
If the conversation implies this file ('${filePath}') should ultimately be deleted, respond ONLY with the exact text "DELETE_FILE".`;
    }
    // --- END NEW Method and Helper ---


    // --- prepareReviewData (Unchanged - Still generates diffs for display) ---
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

    // --- presentChangesForReviewTUI (Unchanged) ---
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

    // --- applyConsolidatedChanges (Unchanged - This method already handles writing full content or deleting) ---
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
                } else { // Handle CREATE or MODIFY (contentOrAction is the full string content)
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