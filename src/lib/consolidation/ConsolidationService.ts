// File: src/lib/consolidation/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from '../FileSystem';
import { AIClient, LogEntryData } from '../AIClient';
import { Config } from '../Config';
import Conversation, { Message, JsonlLogEntry } from '../models/Conversation';
import { GitService } from '../GitService';
import { ConsolidationReviewer } from './ConsolidationReviewer';
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

export class ConsolidationService {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;
    private gitService: GitService;
    private consolidationReviewer: ConsolidationReviewer;
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
        this.consolidationReviewer = new ConsolidationReviewer(this.fs);
        this.consolidationGenerator = new ConsolidationGenerator(
            this.config, this.fs, this.aiClient, this.projectRoot
        );
        this.consolidationApplier = new ConsolidationApplier(this.fs);
        this.consolidationAnalyzer = new ConsolidationAnalyzer(this.aiClient);
    }

    /**
     * Orchestrates the entire consolidation process.
     */
    async process(
        conversationName: string,
        conversation: Conversation,
        currentContextString: string,
        conversationFilePath: string
    ): Promise<void> {
        await this._logStart(conversationName, conversationFilePath);

        try {
            // Step 0: Git Check
            await this._performGitCheck(conversationFilePath);

            // Determine Models
            const models = this._determineModels();

            // Step A: Analyze
            const analysisResult = await this._runAnalysisStep(
                conversation, currentContextString, conversationFilePath, models
            );
            if (!analysisResult) return; // Analysis found nothing or failed critically

            // Step B: Generate
            const finalStates = await this._runGenerationStep(
                conversation, currentContextString, analysisResult, conversationFilePath, models
            );

            // Step C: Review
            const userApproved = await this._runReviewStep(finalStates);

            // Step D: Apply (if approved)
            await this._runApplyStep(userApproved, finalStates, conversationFilePath);

        } catch (error) {
            await this._handleConsolidationError(error, conversationName, conversationFilePath);
        }
    }

    // --- Private Step Helper Methods ---

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
        conversation: Conversation,
        currentContextString: string,
        conversationFilePath: string,
        models: ModelSelection
    ): Promise<ConsolidationAnalysis | null> {
        console.log(chalk.cyan("\n  Step A: Analyzing conversation..."));
        try {
            const analysisResult = await this.consolidationAnalyzer.analyze(
                conversation,
                currentContextString,
                conversationFilePath,
                models.useFlashForAnalysis,
                models.analysisModelName
            );

            if (!analysisResult || !analysisResult.operations || analysisResult.operations.length === 0) {
                console.log(chalk.yellow("  Analysis did not identify any specific file operations. Aborting consolidation."));
                await this._logSystemMessage(conversationFilePath, `System: Analysis (using ${models.analysisModelName}) found 0 ops. Aborting consolidation.`);
                return null; // Indicate no operations found
            }

            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations.`));
            await this._logSystemMessage(conversationFilePath, `System: Analysis (using ${models.analysisModelName}) found ${analysisResult.operations.length} ops...`);
            return analysisResult;
        } catch (error) {
            // Analyzer already logs errors internally, just re-throw to stop process
            console.error(chalk.red(`  Analysis Step Failed.`)); // Add context log
            throw error;
        }
    }

    /** Runs the generation step using ConsolidationGenerator. */
    private async _runGenerationStep(
        conversation: Conversation,
        currentContextString: string,
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string,
        models: ModelSelection
    ): Promise<FinalFileStates> {
        console.log(chalk.cyan("\n  Step B: Generating final file states individually..."));
        try {
            const finalStates = await this.consolidationGenerator.generate(
                conversation,
                currentContextString,
                analysisResult,
                conversationFilePath,
                models.useFlashForGeneration,
                models.generationModelName
            );
            console.log(chalk.green(`  Generation complete: Produced final states for ${Object.keys(finalStates).length} files.`));
            await this._logSystemMessage(conversationFilePath, `System: Generation (using ${models.generationModelName}) produced states for ${Object.keys(finalStates).length} files...`);
            return finalStates;
        } catch (error) {
            // Generator already logs errors internally, just re-throw to stop process
             console.error(chalk.red(`  Generation Step Failed.`)); // Add context log
            throw error;
        }
    }

    /** Runs the review step using ConsolidationReviewer. */
    private async _runReviewStep(finalStates: FinalFileStates): Promise<boolean> {
        // Reviewer handles its own logging internally
        return await this.consolidationReviewer.reviewChanges(finalStates, this.projectRoot);
    }

    /** Runs the apply step using ConsolidationApplier if the user approved. */
    private async _runApplyStep(
        userApproved: boolean,
        finalStates: FinalFileStates,
        conversationFilePath: string
    ): Promise<void> {
        if (userApproved) {
            console.log(chalk.cyan("\n  Step D: Applying approved changes..."));
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

            } catch (error) {
                 console.error(chalk.red(`  Apply Step Failed.`)); // Add context log
                 // Log the error specifically from the apply step before re-throwing
                 await this._logError(conversationFilePath, `Apply Step Failed: ${(error as Error).message}`);
                 throw error;
            }
        } else {
            const msg = `System: Consolidation aborted by user. No changes applied.`;
            console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
            await this._logSystemMessage(conversationFilePath, msg);
        }
    }

    /** Handles and logs errors occurring during the consolidation process. */
    private async _handleConsolidationError(
        error: unknown,
        conversationName: string,
        conversationFilePath: string
    ): Promise<void> {
        console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
        const errorMessage = (error instanceof Error) ? error.message : String(error);

        // Avoid duplicate logging for errors already handled and logged by specific steps
        const isKnownHandledError = errorMessage.includes('Git Check Failed:') ||
                                    errorMessage.includes('Analysis Step Failed.') || // Assuming analyzer logs details
                                    errorMessage.includes('Generation Step Failed.') || // Assuming generator logs details
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
}