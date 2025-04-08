// src/lib/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
import * as Diff from 'diff'; // Still needed for prepareReviewData
import inquirer from 'inquirer'; // Keep for fallback in review TUI failure
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient'; // Correct import
import { Config } from './Config';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager';
// --- Import New Services ---
import { GitService, GitStatusError } from './GitService'; // Import GitService and error type
import { ProjectContextBuilder } from './ProjectContextBuilder'; // Import ProjectContextBuilder

// Removed imports related to Function Calling tools as they are no longer used here
// e.g., Tool, FunctionDeclaration, GenerateContentRequest, FunctionCallingMode etc.

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
    private contextBuilder: ProjectContextBuilder; // Add context builder
    // --- Add GitService ---
    private gitService: GitService;
    // ---

    // --- MODIFIED Constructor Signature ---
    constructor(
        config: Config,
        fileSystem: FileSystem,
        aiClient: AIClient,
        projectRoot: string,
        gitService: GitService // Accept GitService instance
    ) {
    // ---
        this.config = config;
        this.fs = fileSystem;
        this.aiClient = aiClient;
        this.gitService = gitService; // Use injected GitService
        this.contextBuilder = new ProjectContextBuilder(this.fs, projectRoot, this.config); // Instantiate context builder
        this.projectRoot = projectRoot;
    }

    async process(
        conversationName: string,
        conversation: Conversation,
        // currentContextString: string, // Removed from signature - fetch inside
        conversationFilePath: string
    ): Promise<void> {
        const startMsg = `System: Starting AI-driven code consolidation for '${conversationName}'...`;
        console.log(chalk.blue(startMsg.replace('System: ', '')));
        await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: startMsg });

        try {
            // --- *** MOVED GIT CHECK TO THE BEGINNING *** ---
            console.log(chalk.blue("\n  Step 0: Checking Git status..."));
            try {
                const isClean = await this.gitService.isWorkingDirectoryClean();
                if (!isClean) {
                    // Fetch the status again to display it (isWorkingDirectoryClean only returns boolean)
                    // This is slightly inefficient but avoids changing the GitService API for now
                    // Assuming GitService constructor already has ShellExecutor
                    const statusResult = await this.gitService['shellExecutor'].execute('git status --porcelain', { cwd: this.projectRoot }); // Access shellExecutor if needed, slightly hacky access
                    console.error(chalk.red("\nError: Git working directory not clean:"));
                    console.error(chalk.red(statusResult.stdout || "No specific changes reported, but directory is dirty.")); // Display status output
                    const dirtyErrorMsg = 'Git working directory not clean. Consolidation aborted. Please commit or stash changes before consolidating.';
                    throw new Error(dirtyErrorMsg); // Throw to abort the process
                } else {
                    console.log(chalk.green("  Git status clean. Proceeding with consolidation..."));
                }
            } catch (error) {
                // Catch errors from GitService (already formatted)
                const gitCheckErrorMsg = error instanceof Error ? error.message : String(error);
                console.error(chalk.red("\nError checking Git status:"), gitCheckErrorMsg);

                // Log error *before* re-throwing
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: gitCheckErrorMsg });
                throw new Error(gitCheckErrorMsg); // Re-throw to abort
            }
            // --- *** END MOVED GIT CHECK *** ---

            // --- Determine model for consolidation steps ---
            const useFlashForAnalysis = false;
            const useFlashForIndividualGeneration = false;
            const analysisModelName = useFlashForAnalysis ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            const generationModelName = useFlashForIndividualGeneration ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            console.log(chalk.cyan(`  (Using ${analysisModelName} for analysis, ${generationModelName} for individual file generation)`));

            console.log(chalk.cyan("\n  Step A: Analyzing conversation..."));
            // Fetch context *before* analysis
            console.log(chalk.cyan("    Fetching current codebase context..."));
            const { context: currentContextString } = await this.contextBuilder.build();

            // --- *** CALL TO THE NOW-RESTORED METHOD *** ---
            const analysisResult = await this.analyzeConversationForChanges(conversation, currentContextString, conversationFilePath, useFlashForAnalysis, analysisModelName);
            // --- *** END CALL *** ---

            if (!analysisResult || !analysisResult.operations || analysisResult.operations.length === 0) {
                console.log(chalk.yellow("  Analysis did not identify any specific file operations. Consolidation might be incomplete or unnecessary."));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found 0 ops. Aborting consolidation.` });
                return; // Stop if no operations found
            }
            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations.`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found ${analysisResult.operations.length} ops...` });

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

            console.log(chalk.cyan("\n  Step C: Preparing changes for review..."));
            const reviewData = await this.prepareReviewData(finalStates);
            console.log(chalk.green(`  Review preparation complete: ${reviewData.length} files with changes ready for review.`));
            const applyChanges = await this.presentChangesForReviewTUI(reviewData);

            if (applyChanges) {
                console.log(chalk.cyan("\n  Step D: Applying approved changes..."));
                // --- *** CALL TO THE SINGLE, CORRECT applyConsolidatedChanges METHOD *** ---
                await this.applyConsolidatedChanges(finalStates, conversationFilePath);
                // --- *** END CALL *** ---
            } else {
                const msg = `System: Consolidation aborted by user. No changes applied.`;
                console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg });
            }
        } catch (error) {
            // Error logging remains the same
            console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation: ${(error as Error).message}. See console for details.`;
            try {
                if (!(error as Error).message.includes('Git working directory not clean') && !(error as Error).message.includes('Failed to verify Git status')) {
                    const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                    await this.aiClient.logConversation(conversationFilePath, logPayload);
                }
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
            }
        }
    }

    // --- *** RESTORED: analyzeConversationForChanges *** ---
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
    // --- *** END RESTORED METHOD *** ---


    // --- applyConsolidatedChanges (REMOVED Git Check, SINGLE IMPLEMENTATION) ---
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
    // --- *** END applyConsolidatedChanges *** ---


    // --- *** generateIndividualFileContents (Unchanged from previous correct state) *** ---
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

                    const responseTextRaw = await this.aiClient.getResponseTextFromAI(
                        [{ role: 'user', content: individualPrompt }],
                        useFlashModel
                    );

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

                } catch (error) {
                    const errorMsg = `Failed to generate content for ${normalizedPath} using ${modelName}. Error: ${(error as Error).message}`;
                    console.error(chalk.red(`      ${errorMsg}`));
                    await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
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
    // --- END generateIndividualFileContents ---

    // --- _constructIndividualFileGenerationPrompt (Unchanged) ---
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

    // --- prepareReviewData (Unchanged) ---
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
            }

            let diffStr = '';
            let isMeaningful = false;

            if (proposed === 'DELETE_CONFIRMED') {
                action = 'DELETE';
                if (current !== null) {
                    diffStr = Diff.createPatch(relativePath, current, '', '', '', { context: 5 });
                    isMeaningful = true;
                } else {
                    console.log(chalk.gray(`  Skipping review for DELETE ${relativePath} - file already gone.`));
                    continue;
                }
            } else {
                const proposedContent = typeof proposed === 'string' ? proposed : '';

                if (current === null) {
                    action = 'CREATE';
                    diffStr = Diff.createPatch(relativePath, '', proposedContent, '', '', { context: 5 });
                    isMeaningful = proposedContent.trim().length > 0;
                } else {
                    action = 'MODIFY';
                    if (current !== proposedContent) {
                        diffStr = Diff.createPatch(relativePath, current, proposedContent, '', '', { context: 5 });
                        isMeaningful = diffStr.split('\n').slice(2).some(l => l.startsWith('+') || l.startsWith('-'));
                    } else {
                        isMeaningful = false;
                    }
                }
            }

            if (isMeaningful) {
                reviewData.push({ filePath: relativePath, action, diff: diffStr });
            } else {
                console.log(chalk.gray(`  Skipping review for ${relativePath} - no effective changes detected.`));
            }
        }
        return reviewData;
    }

    // --- presentChangesForReviewTUI (Unchanged) ---
    private async presentChangesForReviewTUI(reviewData: ReviewDataItem[]): Promise<boolean> {
        if (reviewData.length === 0) {
            console.log(chalk.yellow("No changes to review."));
            return false;
        }
        console.log(chalk.yellow("\nInitializing Review UI..."));
        try {
            const reviewUI = new ReviewUIManager(reviewData);
            return await reviewUI.run();
        } catch (tuiError) {
            console.error(chalk.red("Error displaying Review TUI:"), tuiError);
            console.log(chalk.yellow("Falling back to simple CLI confirmation."));
            const { confirm } = await inquirer.prompt([{
                type: 'confirm',
                name: 'confirm',
                message: `Review UI failed. Apply ${reviewData.length} file change(s) based on prior summary?`,
                default: false
            }]);
            return confirm;
        }
    }

    // --- *** REMOVED DUPLICATE applyConsolidatedChanges METHOD *** ---
    // The second implementation starting around the original line 454 has been deleted.
}