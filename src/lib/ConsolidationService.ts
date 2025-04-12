// src/lib/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
import * as Diff from 'diff';
// REMOVE child_process and promisify if no longer needed elsewhere in this file
// import { exec as execCb } from 'child_process';
// import { promisify } from 'util';
import inquirer from 'inquirer';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient'; // Correct import
import { Config } from './Config';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager';
import { GitService } from './GitService'; // <-- Keep GitService import

// REMOVE exec if no longer needed
// const exec = promisify(execCb);

// --- Interfaces (Unchanged) ---
interface ConsolidationAnalysis {
    operations: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE' }>;
    // Groups are less critical now but kept in analysis output for potential future use
    groups?: string[][]; // Make groups optional as the simple parser might not produce them
}

interface FinalFileStates {
    // Key is the relative file path
    // Value is the FULL final content string OR 'DELETE_CONFIRMED'
    [filePath: string]: string | 'DELETE_CONFIRMED';
}
// --- End Interfaces ---

export class ConsolidationService {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;
    private gitService: GitService; // <-- Keep GitService instance variable

    // --- *** MODIFY CONSTRUCTOR *** ---
    constructor(
        config: Config,
        fileSystem: FileSystem,
        aiClient: AIClient,
        projectRoot: string,
        gitService: GitService // <-- Accept GitService here
    ) {
        this.config = config;
        this.fs = fileSystem;
        this.aiClient = aiClient;
        this.projectRoot = projectRoot;
        this.gitService = gitService; // <-- Assign the passed instance (removed direct instantiation)
    }
    // --- *** END CONSTRUCTOR MODIFICATION *** ---

    async process(
        conversationName: string,
        conversation: Conversation,
        currentContextString: string,
        conversationFilePath: string
    ): Promise<void> {
        const startMsg = `System: Starting AI-driven code consolidation for '${conversationName}'...`;
        console.log(chalk.blue(startMsg.replace('System: ', '')));
        await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: startMsg });

        try {
            // --- *** USE INJECTED GitService TO CHECK STATUS *** ---
            console.log(chalk.blue("\n  Step 0: Checking Git status..."));
            try {
                // Call the method on the injected gitService instance
                await this.gitService.checkCleanStatus(this.projectRoot);
                console.log(chalk.green("  Proceeding with consolidation..."));
            } catch (gitError: any) {
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: gitError.message });
                throw gitError; // Re-throw to halt the process
            }
            // --- *** END GIT CHECK REFACTOR *** ---

            // --- Determine model for consolidation steps ---
            const useFlashForAnalysis = false;
            const useFlashForIndividualGeneration = false;
            const analysisModelName = useFlashForAnalysis ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            const generationModelName = useFlashForIndividualGeneration ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            console.log(chalk.cyan(`  (Using ${analysisModelName} for analysis, ${generationModelName} for individual file generation)`));

            // --- Step A: Analyzing conversation ---
            console.log(chalk.cyan("\n  Step A: Analyzing conversation..."));
            const analysisResult = await this.analyzeConversationForChanges(conversation, currentContextString, conversationFilePath, useFlashForAnalysis, analysisModelName);
             if (!analysisResult || !analysisResult.operations || analysisResult.operations.length === 0) {
                console.log(chalk.yellow("  Analysis did not identify any specific file operations. Consolidation might be incomplete or unnecessary."));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found 0 ops. Aborting consolidation.` });
                return;
            }
            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations.`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found ${analysisResult.operations.length} ops...` });

            // --- Step B: Generating final file states ---
            console.log(chalk.cyan("\n  Step B: Generating final file states individually..."));
            const finalStates = await this.generateIndividualFileContents(
                conversation,
                currentContextString,
                analysisResult,
                conversationFilePath,
                useFlashForIndividualGeneration,
                generationModelName
            );
            console.log(chalk.green(`  Generation complete: Produced final states for ${Object.keys(finalStates).length} files.`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Generation (using ${generationModelName}) produced states for ${Object.keys(finalStates).length} files...` });

            // --- Step C: Preparing changes for review ---
            console.log(chalk.cyan("\n  Step C: Preparing changes for review..."));
            const reviewData = await this.prepareReviewData(finalStates);
            console.log(chalk.green(`  Review preparation complete: ${reviewData.length} files with changes ready for review.`));
            const applyChanges = await this.presentChangesForReviewTUI(reviewData);

            // --- Step D: Applying approved changes ---
             if (applyChanges) {
                console.log(chalk.cyan("\n  Step D: Applying approved changes..."));
                await this.applyConsolidatedChanges(finalStates, conversationFilePath);
            } else {
                const msg = `System: Consolidation aborted by user. No changes applied.`;
                console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg });
            }

        } catch (error) {
            // --- Updated error handling ---
            console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
            // Log specific Git errors if they weren't caught and logged above (should be caught now)
            // The generic logging remains useful for other error types.
            const errorMsg = `System: Error during consolidation: ${(error as Error).message}. See console for details.`;
            try {
                // Avoid double-logging Git check errors that were already logged
                if (!(error instanceof Error && (error.message.includes('Git working directory not clean') || error.message.includes('Failed to verify Git status') || error.message.includes('Git command not found') || error.message.includes('not a Git repository')))) {
                    const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                    await this.aiClient.logConversation(conversationFilePath, logPayload);
                }
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
            }
            // --- End Updated error handling ---
        }
    }

    // --- analyzeConversationForChanges method ---
    private async analyzeConversationForChanges(
        conversation: Conversation,
        codeContext: string,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string
    ): Promise<ConsolidationAnalysis> {
        console.log(chalk.cyan(`    Requesting analysis from ${modelName}...`));
        const historyString = conversation.getMessages()
            .map((m: Message) => `${m.role}:\n${m.content}\n---\n`)
            .join('');

        const analysisPrompt = `CONTEXT:
You are an expert AI analyzing a coding conversation to determine the necessary file changes.
CODEBASE CONTEXT:
${codeContext}
---
CONVERSATION HISTORY:
${historyString}
---
TASK:
Analyze the CONVERSATION HISTORY in the context of the CODEBASE CONTEXT. Identify all files that need to be created, modified, or deleted to fulfill the user's requests throughout the conversation.

Respond ONLY with a JSON object containing a single key "operations".
The "operations" key should be an array of objects, where each object has:
1.  "filePath": The relative path of the file from the project root (e.g., "src/lib/utils.ts").
2.  "action": A string, either "CREATE", "MODIFY", or "DELETE".

Example Response:
\`\`\`json
{
  "operations": [
    { "filePath": "src/newFeature.js", "action": "CREATE" },
    { "filePath": "README.md", "action": "MODIFY" },
    { "filePath": "old_scripts/cleanup.sh", "action": "DELETE" }
  ]
}
\`\`\`

If no file changes are implied by the conversation, respond with an empty "operations" array:
\`\`\`json
{
  "operations": []
}
\`\`\`

Do NOT include explanations, comments, or any other text outside the JSON object. Ensure the JSON is valid.`;

        try {
            const responseTextRaw = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: analysisPrompt }],
                useFlashModel
            );

            // Clean potential markdown fences
            let responseTextClean = responseTextRaw.trim();
            const jsonMatch = responseTextClean.match(/```(?:json)?\s*([\s\S]*?)\s*```/); // Extract content within ```json ... ```
            if (jsonMatch && jsonMatch[1]) {
                responseTextClean = jsonMatch[1].trim();
            } else if (responseTextClean.startsWith('{') && responseTextClean.endsWith('}')) {
                // Assume it's raw JSON if it looks like it
            } else {
                throw new Error(`Analysis response from ${modelName} was not in the expected JSON format. Raw: ${responseTextRaw}`);
            }

            const analysis: ConsolidationAnalysis = JSON.parse(responseTextClean);

            // Validate the structure
            if (!analysis || !Array.isArray(analysis.operations)) {
                throw new Error(`Invalid JSON structure received from ${modelName}. Expected { "operations": [...] }. Received: ${responseTextClean}`);
            }
            // Optional: Deeper validation of each operation object
            for (const op of analysis.operations) {
                if (!op.filePath || !op.action || !['CREATE', 'MODIFY', 'DELETE'].includes(op.action)) {
                    console.warn(chalk.yellow(`  Warning: Invalid operation structure found in analysis:`), op);
                    // Decide whether to filter out invalid ops or throw an error
                }
                // Normalize file path separators
                op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
            }

            console.log(chalk.cyan(`    Analysis received from ${modelName}. Found ${analysis.operations.length} operations.`));
            return analysis;

        } catch (error) {
            const errorMsg = `Failed to analyze conversation using ${modelName}. Error: ${(error as Error).message}`;
            console.error(chalk.red(`    ${errorMsg}`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            // Rethrow or return a default empty state? Rethrowing is safer to halt the process.
            throw new Error(errorMsg);
        }
    }

    // --- applyConsolidatedChanges method ---
    private async applyConsolidatedChanges(finalStates: FinalFileStates, conversationFilePath: string): Promise<void> {
         // --- Git status check was moved to the start of `process` ---
        console.log(chalk.blue("Proceeding with file operations..."));

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
                        summary.push(`Deleted: ${relativePath}`);
                        success++;
                    } catch (accessError) {
                        if ((accessError as NodeJS.ErrnoException).code === 'ENOENT') {
                            console.warn(chalk.yellow(`  Skipped delete (already gone): ${relativePath}`));
                            summary.push(`Skipped delete (already gone): ${relativePath}`);
                            skipped++;
                        } else {
                            throw accessError; // Rethrow unexpected delete/access errors
                        }
                    }
                } else {
                    // Ensure directory exists before writing the file
                    await this.fs.ensureDirExists(path.dirname(absolutePath));
                    // Write the file content (handles both create and modify)
                    await this.fs.writeFile(absolutePath, contentOrAction);
                    console.log(chalk.green(`  Written: ${relativePath}`));
                    summary.push(`Written: ${relativePath}`);
                    success++;
                }
            } catch (error) {
                console.error(chalk.red(`  Failed apply operation for ${relativePath}:`), error);
                summary.push(`Failed ${contentOrAction === 'DELETE_CONFIRMED' ? 'delete' : 'write'}: ${relativePath} - ${(error as Error).message}`);
                failed++;
            }
        }

        // --- Summary logging remains the same ---
        console.log(chalk.blue("\n--- Consolidation Apply Summary ---"));
        summary.forEach(l => console.log(l.startsWith("Failed") ? chalk.red(`- ${l}`) : l.startsWith("Skipped") ? chalk.yellow(`- ${l}`) : chalk.green(`- ${l}`)));
        console.log(chalk.blue(`---------------------------------`));
        console.log(chalk.blue(`Applied: ${success}, Skipped/No-op: ${skipped}, Failed: ${failed}.`));

        try {
            const title = failed > 0 ? 'Consolidation Summary (with failures)' : 'Consolidation Summary';
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `${title}:\n${summary.join('\n')}` });
        } catch (logErr) {
            console.warn(chalk.yellow("Warning: Could not log apply summary to conversation file."), logErr);
        }

        if (failed > 0) {
            throw new Error(`Consolidation apply step completed with ${failed} failure(s). Please review the errors.`);
        }
    }

    // --- generateIndividualFileContents method ---
    private async generateIndividualFileContents(
        conversation: Conversation,
        codeContext: string,
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string
    ): Promise<FinalFileStates> {
        const finalStates: FinalFileStates = {};

        const filesToGenerate = analysisResult.operations
            .filter(op => op.action === 'CREATE' || op.action === 'MODIFY')
            .map(op => op.filePath);

        if (filesToGenerate.length === 0) {
            console.log(chalk.yellow("    No files require content generation based on analysis."));
        } else {
            console.log(chalk.cyan(`    Generating content for ${filesToGenerate.length} file(s) individually using ${modelName}...`));

            let attempt = 0; // Define attempt here to use it in catch block below
            for (const filePath of filesToGenerate) {
                const normalizedPath = path.normalize(filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                console.log(chalk.cyan(`      Generating content for: ${normalizedPath}`));

                try {
                    let currentContent: string | null = null;
                    try {
                        currentContent = await this.fs.readFile(path.resolve(this.projectRoot, normalizedPath));
                    } catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
                    }

                    const individualPrompt = this._constructIndividualFileGenerationPrompt(
                        conversation,
                        codeContext,
                        normalizedPath,
                        currentContent
                    );

                     // --- ADD RETRY LOGIC HERE (as an example, using simple loop) ---
                     let responseTextRaw = '';
                     attempt = 0; // Reset attempt count for each file
                     const maxAttempts = this.config.gemini.generation_max_retries ?? 3; // Use config value
                     const baseDelay = this.config.gemini.generation_retry_base_delay_ms ?? 2000; // Use config value

                     while (attempt <= maxAttempts) {
                         try {
                              console.log(chalk.dim(`        (Attempt ${attempt + 1}/${maxAttempts + 1}) Calling AI for ${normalizedPath}...`));
                             responseTextRaw = await this.aiClient.getResponseTextFromAI(
                                 [{ role: 'user', content: individualPrompt }],
                                 useFlashModel
                             );
                             break; // Success, exit loop
                         } catch (aiError: any) {
                             // Check if the error is potentially retryable (e.g., rate limit, server error)
                             // You might need more sophisticated checking based on the AIClient's error types/codes
                             const isRetryable = ['RATE_LIMIT', 'SERVER_OVERLOADED', 'NETWORK_ERROR', 'NO_RESPONSE'].includes(aiError.code) ||
                                                 aiError.message?.includes('500') || aiError.message?.includes('503') || aiError.message?.toLowerCase().includes('rate limit');

                             if (isRetryable && attempt < maxAttempts) {
                                 attempt++;
                                 const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
                                 console.warn(chalk.yellow(`        AI Error for ${normalizedPath} (Attempt ${attempt}): ${aiError.message}. Retrying in ${delay / 1000}s...`));
                                 await new Promise(resolve => setTimeout(resolve, delay));
                             } else {
                                 console.error(chalk.red(`        Failed AI call for ${normalizedPath} after ${attempt + 1} attempts.`));
                                 throw aiError; // Non-retryable or max attempts reached, re-throw
                             }
                         }
                     }
                     // --- END RETRY LOGIC ---

                    let responseTextClean = responseTextRaw.trim();
                    const startsWithFence = responseTextClean.match(/^```(?:[\w-]+)?\s*\n/);
                    const endsWithFence = responseTextClean.endsWith('\n```');

                    if (startsWithFence && endsWithFence) {
                        console.warn(chalk.yellow(`      Note: Removing markdown fences from AI response for ${normalizedPath}`));
                        responseTextClean = responseTextClean.substring(startsWithFence[0].length, responseTextClean.length - 4).trim();
                    } else if (startsWithFence || endsWithFence) {
                        console.warn(chalk.yellow(`      Warning: Found partial markdown fence in AI response for ${normalizedPath}. Using content as is.`));
                    }

                    if (responseTextClean === "DELETE_FILE") {
                        finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                        console.log(chalk.yellow(`      AI suggested DELETE for ${normalizedPath}. Marked for deletion.`));
                        await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: AI suggested DELETE for ${normalizedPath} during individual generation.` });
                    } else {
                        finalStates[normalizedPath] = responseTextClean;
                        console.log(chalk.green(`      Successfully generated content for ${normalizedPath} (Length: ${responseTextClean.length})`));
                    }

                } catch (error) { // Catch errors from the retry block or non-retryable ones
                    const errorMsg = `Failed to generate content for ${normalizedPath} using ${modelName} after ${attempt + 1} attempts. Error: ${(error as Error).message}`;
                    console.error(chalk.red(`      ${errorMsg}`));
                    await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
                    // Let the user know generation failed for this file. Consider if the whole process should stop.
                }
            }
        }

        for (const op of analysisResult.operations) {
            if (op.action === 'DELETE') {
                const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                if (!(normalizedPath in finalStates)) {
                    console.log(chalk.dim(`      Marking DELETE for ${normalizedPath} based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                } else if (finalStates[normalizedPath] !== 'DELETE_CONFIRMED') {
                    console.warn(chalk.yellow(`      Warning: ${normalizedPath} was marked DELETE in analysis, but generation step provided content. Prioritizing DELETE based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                    await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Overriding generated content for ${normalizedPath} with DELETE based on analysis.` });
                }
            }
        }

        return finalStates;
    }

    // --- _constructIndividualFileGenerationPrompt method ---
    private _constructIndividualFileGenerationPrompt(
        conversation: Conversation,
        codeContext: string,
        filePath: string,
        currentContent: string | null
    ): string {
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

    // --- prepareReviewData method ---
    private async prepareReviewData(finalStates: FinalFileStates): Promise<ReviewDataItem[]> {
        const reviewData: ReviewDataItem[] = [];
        for (const relativePath in finalStates) {
            const proposed = finalStates[relativePath];
            const absolutePath = path.resolve(this.projectRoot, relativePath);
            let current: string | null = null;
            let action: ReviewAction = 'MODIFY';

            try {
                current = await this.fs.readFile(absolutePath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.error(chalk.red(`Error reading current state of ${relativePath}:`), error);
                    throw error;
                }
                // If ENOENT, current remains null, indicating creation
            }

            let diffStr = '';
            let isMeaningful = false;

            if (proposed === 'DELETE_CONFIRMED') {
                action = 'DELETE';
                if (current !== null) {
                    // Generate diff from current state to empty state
                    diffStr = Diff.createPatch(relativePath, current, '', '', '', { context: 5 });
                    isMeaningful = true; // Deleting an existing file is meaningful
                } else {
                    // File was marked for delete but doesn't exist, skip review
                    console.log(chalk.gray(`  Skipping review for DELETE ${relativePath} - file already gone.`));
                    continue; // Move to the next file
                }
            } else {
                // Ensure proposed is a string (handle potential type issues)
                const proposedContent = typeof proposed === 'string' ? proposed : '';

                if (current === null) {
                    action = 'CREATE';
                    // Generate diff from empty state to proposed content
                    diffStr = Diff.createPatch(relativePath, '', proposedContent, '', '', { context: 5 });
                    // Creation is meaningful only if content is not just whitespace
                    isMeaningful = proposedContent.trim().length > 0;
                } else {
                    action = 'MODIFY';
                    if (current !== proposedContent) {
                        // Generate diff between current and proposed content
                        diffStr = Diff.createPatch(relativePath, current, proposedContent, '', '', { context: 5 });
                        // Check if the diff introduces actual changes beyond headers/whitespace
                        // A simple check: does the diff contain '+' or '-' lines (excluding file headers)?
                        isMeaningful = diffStr.split('\n').slice(2).some(l => l.startsWith('+') || l.startsWith('-'));
                    } else {
                        // Current and proposed content are identical
                        isMeaningful = false;
                    }
                }
            }

            // Add to review data only if the change is meaningful
            if (isMeaningful) {
                reviewData.push({ filePath: relativePath, action, diff: diffStr });
            } else {
                console.log(chalk.gray(`  Skipping review for ${relativePath} - no effective changes detected.`));
            }
        }
        return reviewData;
    }

    // --- presentChangesForReviewTUI method ---
    private async presentChangesForReviewTUI(reviewData: ReviewDataItem[]): Promise<boolean> {
        if (reviewData.length === 0) {
            console.log(chalk.yellow("No changes to review."));
            return false; // No changes means don't apply anything
        }

        console.log(chalk.yellow("\nInitializing Review UI..."));
        try {
            // Instantiate and run the TUI
            const reviewUI = new ReviewUIManager(reviewData);
            const userDecision = await reviewUI.run(); // This promise resolves with true (Apply) or false (Reject)
            return userDecision;

        } catch (tuiError) {
            // Fallback to simple CLI confirmation if TUI fails
            console.error(chalk.red("Error displaying Review TUI:"), tuiError);
            console.log(chalk.yellow("Falling back to simple CLI confirmation."));

            // Summarize changes for the fallback prompt
            const changeSummary = reviewData.map(item => `  ${item.action.padEnd(6)}: ${item.filePath}`).join('\n');
            console.log(chalk.cyan("\nProposed changes:"));
            console.log(changeSummary);

            const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
                type: 'confirm',
                name: 'confirm',
                message: `Review UI failed. Apply the ${reviewData.length} file change(s) listed above?`,
                default: false // Default to not applying changes for safety
            }]);
            return confirm;
        }
    }
}