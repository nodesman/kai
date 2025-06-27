// File: src/lib/consolidation/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from '../FileSystem';
import { AIClient, LogEntryData } from '../AIClient';
import { Config } from '../Config';
import Conversation, { Message, JsonlLogEntry } from '../models/Conversation';
import { GitService } from '../GitService';
// REMOVED: import { ConsolidationReviewer } from './ConsolidationReviewer';
import { ConsolidationGenerator } from './ConsolidationGenerator';
import { ConsolidationApplier } from './ConsolidationApplier';
import { ConsolidationAnalyzer } from './ConsolidationAnalyzer';
import { FinalFileStates, ConsolidationAnalysis } from './types';

interface ModelSelection {
    analysisModelName: string;
    generationModelName: string;
    useFlashForAnalysis: boolean;
    useFlashForGeneration: boolean;
}

// Define a marker for successful consolidation
const CONSOLIDATION_SUCCESS_MARKER = "[System: Consolidation Completed Successfully]";

export class ConsolidationService {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;
    private gitService: GitService;
    // REMOVED: private consolidationReviewer: ConsolidationReviewer;
    private consolidationGenerator: ConsolidationGenerator;
    private consolidationApplier: ConsolidationApplier;
    private consolidationAnalyzer: ConsolidationAnalyzer;

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
        // REMOVED: this.consolidationReviewer = new ConsolidationReviewer(this.fs);
        this.consolidationGenerator = new ConsolidationGenerator(
            this.config, this.fs, this.aiClient, this.projectRoot
        );
        this.consolidationApplier = new ConsolidationApplier(this.fs);
        this.consolidationAnalyzer = new ConsolidationAnalyzer(this.aiClient);
    }

    /**
     * Updates the AI client used by all consolidation components.
     */
    updateAIClient(aiClient: AIClient): void {
        this.aiClient = aiClient;
        this.consolidationGenerator.setAIClient(aiClient);
        this.consolidationAnalyzer.setAIClient(aiClient);
    }

    /**
     * Orchestrates the entire consolidation process.
     */
    async process(
        conversationName: string,
        conversation: Conversation, // Receive the full conversation
        currentContextString: string,
        conversationFilePath: string
    ): Promise<void> {
        await this._logStart(conversationName, conversationFilePath);
        let consolidationSucceeded = false; // Flag to track success for logging marker
        let changesApplied = false; // Flag to track if apply step actually ran successfully

        try {
            // Step 0: Git Check
            await this._performGitCheck(conversationFilePath);

            // --- Step 0.5: Determine Relevant History ---
            const relevantHistory = this._findRelevantHistorySlice(conversation);
            if (relevantHistory.length === 0) {
                console.log(chalk.yellow("  No relevant new conversation history found since last successful consolidation. Skipping."));
                await this._logSystemMessage(conversationFilePath, "System: No new history since last successful consolidation. Skipping.");
                return;
            }
            console.log(chalk.blue(`  Processing ${relevantHistory.length} relevant messages since last consolidation.`));
            // --- End Relevant History Determination ---

            // Determine Models
            const models = this._determineModels();

            // Step A: Analyze (using relevant history)
            const analysisResult = await this._runAnalysisStep(
                relevantHistory, // Pass the slice
                currentContextString,
                conversationFilePath,
                models
            );
            if (!analysisResult) return; // Analysis found nothing or failed critically

            // Step B: Generate (using relevant history)
            const finalStates = await this._runGenerationStep(
                relevantHistory, // Pass the slice
                currentContextString,
                analysisResult,
                conversationFilePath,
                models
            );

            // REMOVED: Step C: Review
            // const userApproved = await this._runReviewStep(finalStates); // REMOVED

            // Step C: Apply (always attempts if generation succeeded)
            changesApplied = await this._runApplyStep(finalStates, conversationFilePath); // Modified call

            // Mark overall success if we reached here and changes were applied
            if (changesApplied) { // Simplified success condition
                consolidationSucceeded = true;
            }

        } catch (error) {
            await this._handleConsolidationError(error, conversationName, conversationFilePath);
            consolidationSucceeded = false; // Ensure flag is false on error
        } finally {
            // Add success marker only if the process completed without errors AND changes were applied
            if (consolidationSucceeded) {
                await this._logSuccessMarker(conversationFilePath);
                conversation.addMessage('system', CONSOLIDATION_SUCCESS_MARKER); // Add to in-memory convo too
            }
        }
    }

    // --- Private Step Helper Methods ---

    /** Finds the portion of history after the last successful consolidation marker. */
    private _findRelevantHistorySlice(conversation: Conversation): Message[] {
        const allMessages = conversation.getMessages();
        let lastSuccessIndex = -1;

        // Find the index of the *last* success marker
        for (let i = allMessages.length - 1; i >= 0; i--) {
            if (allMessages[i].role === 'system' && allMessages[i].content === CONSOLIDATION_SUCCESS_MARKER) {
                lastSuccessIndex = i;
                break;
            }
        }

        // Slice the array from the message *after* the marker
        return allMessages.slice(lastSuccessIndex + 1);
    }

    /** Logs the start of the consolidation process. */
    private async _logStart(conversationName: string, conversationFilePath: string): Promise<void> {
        const startMsg = `System: Starting AI-driven code consolidation for '${conversationName}'...`;
        console.log(chalk.blue(startMsg.replace('System: ', '')));
        await this._logSystemMessage(conversationFilePath, startMsg);
    }

    /** Performs the Git working directory cleanliness check. */
    private async _performGitCheck(conversationFilePath: string): Promise<void> {
        console.log(chalk.blue("\n  Step 0: Checking Git status..."));
        try {
            await this.gitService.checkCleanStatus(this.projectRoot);
            console.log(chalk.green("  Git status clean. Proceeding..."));
        } catch (gitError: any) {
            // Log specific error to conversation before re-throwing
            await this._logError(conversationFilePath, `Git Check Failed: ${gitError.message}`);
            throw gitError; // Re-throw to stop the process
        }
    }

    /** Determines which AI models to use for analysis and generation. */
    private _determineModels(): ModelSelection {
        // TODO: Make these flags configurable if needed
        const useFlashForAnalysis = false;
        const useFlashForGeneration = false;

        const analysisModelName = useFlashForAnalysis
            ? (this.config.gemini.subsequent_chat_model_name || 'Flash')
            : (this.config.gemini.model_name || 'Pro');
        const generationModelName = useFlashForGeneration
            ? (this.config.gemini.subsequent_chat_model_name || 'Flash')
            : (this.config.gemini.model_name || 'Pro');

        console.log(chalk.cyan(`  (Using ${analysisModelName} for analysis, ${generationModelName} for generation)`));

        return {
            analysisModelName,
            generationModelName,
            useFlashForAnalysis,
            useFlashForGeneration: useFlashForGeneration
        };
    }

    /** Runs the analysis step using ConsolidationAnalyzer. */
    private async _runAnalysisStep(
        relevantHistory: Message[], // Accepts relevant history slice
        currentContextString: string,
        conversationFilePath: string,
        models: ModelSelection
    ): Promise<ConsolidationAnalysis | null> {
        console.log(chalk.cyan("\n  Step A: Analyzing relevant conversation history..."));
        try {
            // Pass relevant history slice to the analyzer
            const analysisResult = await this.consolidationAnalyzer.analyze(
                relevantHistory, // <-- Use the slice
                currentContextString,
                conversationFilePath,
                models.useFlashForAnalysis,
                models.analysisModelName
            );

            if (!analysisResult || !analysisResult.operations || analysisResult.operations.length === 0) { // Correct check
                console.log(chalk.yellow("  Analysis did not identify any specific file operations in the recent history. Aborting consolidation."));
                await this._logSystemMessage(conversationFilePath, `System: Analysis (using ${models.analysisModelName}) found 0 ops in recent history. Aborting consolidation.`);
                return null; // Indicate no operations found
            }

            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations from recent history.`));
            await this._logSystemMessage(conversationFilePath, `System: Analysis (using ${models.analysisModelName}) found ${analysisResult.operations.length} ops from recent history...`);
            return analysisResult;
        } catch (error) {
             console.error(chalk.red(`  Analysis Step Failed.`));
             // Log the error before throwing, if not already logged by analyzer
             if (error instanceof Error && !error.message.includes('Analysis response')) {
                 await this._logError(conversationFilePath, `Analysis Step Failed: ${error.message}`);
             }
             throw error; // Analyzer might log details, but we ensure logging here too
        }
    }

    /** Runs the generation step using ConsolidationGenerator. */
    private async _runGenerationStep(
        relevantHistory: Message[], // Accepts relevant history slice
        currentContextString: string,
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string,
        models: ModelSelection
    ): Promise<FinalFileStates> {
        console.log(chalk.cyan("\n  Step B: Generating final file states individually based on recent history..."));
        try {
            // Pass relevant history slice to the generator
            const finalStates = await this.consolidationGenerator.generate(
                relevantHistory, // <-- Use the slice
                currentContextString,
                analysisResult,
                conversationFilePath,
                models.useFlashForGeneration,
                models.generationModelName
            );
            console.log(chalk.green(`  Generation complete: Produced final states for ${Object.keys(finalStates).length} files based on recent history.`));
            await this._logSystemMessage(conversationFilePath, `System: Generation (using ${models.generationModelName}) produced states for ${Object.keys(finalStates).length} files based on recent history...`);
            return finalStates;
        } catch (error) {
             console.error(chalk.red(`  Generation Step Failed.`));
             if (error instanceof Error) { // Log before throwing
                await this._logError(conversationFilePath, `Generation Step Failed: ${error.message}`);
             }
             throw error; // Generator might log details
        }
    }

    // REMOVED: private async _runReviewStep(...)

    /** Runs the apply step using ConsolidationApplier. Returns true if changes were applied successfully, false otherwise. */
    private async _runApplyStep(
        finalStates: FinalFileStates, // Removed userApproved parameter
        conversationFilePath: string
    ): Promise<boolean> {
        // Removed the 'if (userApproved)' check
        console.log(chalk.cyan("\n  Step C: Applying generated changes directly...")); // Renumbered step
        try {
            const { success, failed, skipped, summary } = await this.consolidationApplier.apply(
                finalStates,
                this.projectRoot
            );

            // Log summary to conversation file
            const title = failed > 0 ? 'Consolidation Apply Summary (with failures)' : 'Consolidation Apply Summary';
            await this._logSystemMessage(conversationFilePath, `${title}:\n${summary.join('\n')}`);

            // Throw an error if any apply operations failed
            if (failed > 0) {
                throw new Error(`Consolidation apply step completed with ${failed} failure(s). Please review the errors logged above and in the conversation file.`);
            }
            console.log(chalk.green(`  Apply step completed successfully.`));
            return true; // Changes were successfully applied

        } catch (error) {
             console.error(chalk.red(`  Apply Step Failed.`)); // Add context log
             // Log the error specifically from the apply step before re-throwing
             await this._logError(conversationFilePath, `Apply Step Failed: ${(error as Error).message}`);
             throw error; // Re-throw the error
        }
        // Removed the 'else' block related to user not approving
    }

    /** Handles and logs errors occurring during the consolidation process. */
    private async _handleConsolidationError(
        error: unknown,
        conversationName: string,
        conversationFilePath: string
    ): Promise<void> {
        // Keep existing error handling, it's general enough
         console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
         const errorMessage = (error instanceof Error) ? error.message : String(error);
         // Avoid duplicate logging for errors already handled and logged by specific steps
         const isKnownHandledError = errorMessage.includes('Git Check Failed:') ||
                                 errorMessage.includes('Analysis Step Failed:') ||
                                 errorMessage.includes('Generation Step Failed:') ||
                                 errorMessage.includes('Apply Step Failed:') ||
                                 errorMessage.includes('Consolidation apply step completed with');

         if (!isKnownHandledError) {
             await this._logError(conversationFilePath, `Consolidation failed: ${errorMessage}`);
         }
        // No need to re-throw here, as the main process loop will terminate.
    }

    // --- Private Logging Helpers ---

    /** Logs an error message to the conversation file. */
    private async _logError(conversationFilePath: string, errorMsg: string): Promise<void> {
        try {
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
        } catch (logErr) {
            console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
        }
    }

     /** Logs a system message to the conversation file. */
     private async _logSystemMessage(conversationFilePath: string, message: string): Promise<void> {
        try {
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: message });
        } catch (logErr) {
            console.error(chalk.red("Additionally failed to log system message:"), logErr);
        }
    }

     /** Logs the success marker to the conversation file. */
     private async _logSuccessMarker(conversationFilePath: string): Promise<void> {
         try {
             console.log(chalk.green("  Consolidation completed successfully. Logging marker."));
             await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: CONSOLIDATION_SUCCESS_MARKER });
         } catch (logErr) {
             console.error(chalk.red("Failed to log consolidation success marker:"), logErr);
         }
     }
}