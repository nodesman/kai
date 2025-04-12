// File: src/lib/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
// REMOVED: import * as Diff from 'diff';
// REMOVED: import inquirer from 'inquirer';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient'; // Correct import
import { Config } from './Config';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
// REMOVED: import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager';
import { GitService } from './GitService';
import { ConsolidationPrompts } from './prompts';
import { ConsolidationReviewer } from './ConsolidationReviewer'; // <-- ADDED THIS IMPORT

// Define FinalFileStates interface here
export interface FinalFileStates {
    [filePath: string]: string | 'DELETE_CONFIRMED';
}

// Keep ConsolidationAnalysis interface
interface ConsolidationAnalysis {
    operations: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE' }>;
    groups?: string[][];
}

export class ConsolidationService {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;
    private gitService: GitService;
    private consolidationReviewer: ConsolidationReviewer; // <-- ADDED THIS

    constructor(
        config: Config,
        fileSystem: FileSystem,
        aiClient: AIClient,
        projectRoot: string,
        gitService: GitService
    ) {
        this.config = config;
        this.fs = fileSystem;
        this.aiClient = aiClient;
        this.projectRoot = projectRoot;
        this.gitService = gitService;
        this.consolidationReviewer = new ConsolidationReviewer(this.fs); // <-- INSTANTIATED HERE
    }

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
            // Step 0: Git Check
            console.log(chalk.blue("\n  Step 0: Checking Git status..."));
            try {
                await this.gitService.checkCleanStatus(this.projectRoot);
                console.log(chalk.green("  Proceeding with consolidation..."));
            } catch (gitError: any) {
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: gitError.message });
                throw gitError;
            }

            // Determine models
            const useFlashForAnalysis = false;
            const useFlashForIndividualGeneration = false;
            const analysisModelName = useFlashForAnalysis ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            const generationModelName = useFlashForIndividualGeneration ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            console.log(chalk.cyan(`  (Using ${analysisModelName} for analysis, ${generationModelName} for individual file generation)`));


            // Step A: Analysis
            console.log(chalk.cyan("\n  Step A: Analyzing conversation..."));
            const analysisResult = await this.analyzeConversationForChanges(conversation, currentContextString, conversationFilePath, useFlashForAnalysis, analysisModelName);
             if (!analysisResult || !analysisResult.operations || analysisResult.operations.length === 0) {
                console.log(chalk.yellow("  Analysis did not identify any specific file operations. Consolidation might be incomplete or unnecessary."));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found 0 ops. Aborting consolidation.` });
                return;
            }
            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations.`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found ${analysisResult.operations.length} ops...` });


            // Step B: Generation
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


            // --- Step C: Review Changes (Delegated) ---
            const applyChanges = await this.consolidationReviewer.reviewChanges(finalStates, this.projectRoot);
            // --- END DELEGATION ---


            // Step D: Apply Changes
             if (applyChanges) {
                console.log(chalk.cyan("\n  Step D: Applying approved changes..."));
                await this.applyConsolidatedChanges(finalStates, conversationFilePath); // This method remains
            } else {
                const msg = `System: Consolidation aborted by user. No changes applied.`;
                console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg });
            }

        } catch (error) {
            // Error Handling
            console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation: ${(error as Error).message}. See console for details.`;
            try {
                if (!(error instanceof Error && (error.message.includes('Git working directory not clean') || error.message.includes('Failed to verify Git status') || error.message.includes('Git command not found') || error.message.includes('not a Git repository')))) {
                    const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                    await this.aiClient.logConversation(conversationFilePath, logPayload);
                }
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
            }
        }
    }

    // --- analyzeConversationForChanges (Unchanged logic) ---
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

        const analysisPrompt = ConsolidationPrompts.analysisPrompt(codeContext, historyString);

        try {
            const responseTextRaw = await this.aiClient.getResponseTextFromAI(
                [{ role: 'user', content: analysisPrompt }],
                useFlashModel
            );

            let responseTextClean = responseTextRaw.trim();
            const jsonMatch = responseTextClean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                responseTextClean = jsonMatch[1].trim();
            } else if (responseTextClean.startsWith('{') && responseTextClean.endsWith('}')) {
                // Assume raw JSON
            } else {
                throw new Error(`Analysis response from ${modelName} was not in the expected JSON format. Raw: ${responseTextRaw}`);
            }

            const analysis: ConsolidationAnalysis = JSON.parse(responseTextClean);

            if (!analysis || !Array.isArray(analysis.operations)) {
                throw new Error(`Invalid JSON structure received from ${modelName}. Expected { "operations": [...] }. Received: ${responseTextClean}`);
            }
            for (const op of analysis.operations) {
                if (!op.filePath || !op.action || !['CREATE', 'MODIFY', 'DELETE'].includes(op.action)) {
                    console.warn(chalk.yellow(`  Warning: Invalid operation structure found in analysis:`), op);
                }
                op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
            }

            console.log(chalk.cyan(`    Analysis received from ${modelName}. Found ${analysis.operations.length} operations.`));
            return analysis;

        } catch (error) {
            const errorMsg = `Failed to analyze conversation using ${modelName}. Error: ${(error as Error).message}`;
            console.error(chalk.red(`    ${errorMsg}`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            throw new Error(errorMsg);
        }
    }

    // --- generateIndividualFileContents (Complete and Unchanged logic) ---
    private async generateIndividualFileContents(
        conversation: Conversation,
        codeContext: string,
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string
    ): Promise<FinalFileStates> {
        const finalStates: FinalFileStates = {};
        const historyString = conversation.getMessages()
            .map((m: Message) => `${m.role}:\n${m.content}\n---\n`)
            .join('');

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

                    const individualPrompt = ConsolidationPrompts.individualFileGenerationPrompt(
                        codeContext,
                        historyString,
                        normalizedPath,
                        currentContent
                    );

                     // --- RETRY LOGIC ---
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
                             // This is a simplified check; more robust checking might be needed based on AIClient errors
                             const isRetryable = ['RATE_LIMIT', 'SERVER_OVERLOADED', 'NETWORK_ERROR', 'NO_RESPONSE'].includes(aiError.code) ||
                                                 aiError.message?.includes('500') || aiError.message?.includes('503') || aiError.message?.toLowerCase().includes('rate limit') || aiError.message?.toLowerCase().includes('retry');

                             if (isRetryable && attempt < maxAttempts) {
                                 attempt++;
                                 const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
                                 console.warn(chalk.yellow(`        AI Error for ${normalizedPath} (Attempt ${attempt}/${maxAttempts}): ${aiError.message}. Retrying in ${delay / 1000}s...`));
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
                    // Decide how to handle: stop the whole process, or skip this file? Skipping for now.
                    // Maybe add a placeholder or error state to finalStates?
                    // finalStates[normalizedPath] = `/* ERROR: Generation failed: ${(error as Error).message} */`;
                }
            }
        }

        // Handle DELETE actions from analysis that weren't generated (or overridden by generation)
        for (const op of analysisResult.operations) {
            if (op.action === 'DELETE') {
                const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                if (!(normalizedPath in finalStates)) {
                    // If the file wasn't generated (correct), mark it for deletion based on analysis
                    console.log(chalk.dim(`      Marking DELETE for ${normalizedPath} based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                } else if (finalStates[normalizedPath] !== 'DELETE_CONFIRMED') {
                    // If generation *did* produce content but analysis says DELETE, prioritize DELETE
                    console.warn(chalk.yellow(`      Warning: ${normalizedPath} was marked DELETE in analysis, but generation step provided content. Prioritizing DELETE based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                    await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Overriding generated content for ${normalizedPath} with DELETE based on analysis.` });
                }
            }
        }

        return finalStates;
    }

    // --- applyConsolidatedChanges (Unchanged logic) ---
    private async applyConsolidatedChanges(finalStates: FinalFileStates, conversationFilePath: string): Promise<void> {
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
                            throw accessError;
                        }
                    }
                } else {
                    await this.fs.ensureDirExists(path.dirname(absolutePath));
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

    // --- REMOVED prepareReviewData method ---
    // --- REMOVED presentChangesForReviewTUI method ---
}