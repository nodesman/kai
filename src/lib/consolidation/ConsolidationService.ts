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
// Removed date-fns import as it's no longer needed for tagging

interface ModelSelection {
    analysisModelName: string;
    generationModelName: string;
    useFlashForAnalysis: boolean;
    useFlashForGeneration: boolean;
}

// Define a marker for successful consolidation
const CONSOLIDATION_SUCCESS_MARKER = "[System: Consolidation Completed Successfully]";
const TAG_PREFIX = "kai_consolidate_v"; // Define the prefix for automatic tags

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

            // Step C: Review
            const userApproved = await this._runReviewStep(finalStates);

            // Step D: Apply (if approved)
            changesApplied = await this._runApplyStep(userApproved, finalStates, conversationFilePath); // Store result

            // Step E: Tag (if approved and applied)
            if (userApproved && changesApplied) {
                await this._runTaggingStep(conversationName, conversationFilePath); // Pass conversation name
            }

            // Mark overall success if we reached here and changes were applied/approved
            if (userApproved && changesApplied) {
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

    /** Runs the review step using ConsolidationReviewer. */
    private async _runReviewStep(finalStates: FinalFileStates): Promise<boolean> {
        // Reviewer handles its own logging internally
        return await this.consolidationReviewer.reviewChanges(finalStates, this.projectRoot);
    }

    /** Runs the apply step using ConsolidationApplier if the user approved. Returns true if changes were applied successfully, false otherwise. */
    private async _runApplyStep(
        userApproved: boolean,
        finalStates: FinalFileStates,
        conversationFilePath: string
    ): Promise<boolean> {
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
                return true; // Changes were successfully applied

            } catch (error) {
                 console.error(chalk.red(`  Apply Step Failed.`)); // Add context log
                 // Log the error specifically from the apply step before re-throwing
                 await this._logError(conversationFilePath, `Apply Step Failed: ${(error as Error).message}`);
                 throw error; // Re-throw the error
            }
        } else {
            const msg = `System: Consolidation aborted by user. No changes applied.`;
            console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
            await this._logSystemMessage(conversationFilePath, msg);
            return false; // No changes were applied
        }
    }

    /** Runs the automatic Git tagging step using SemVer. */
    private async _runTaggingStep(conversationName: string, conversationFilePath: string): Promise<void> {
        console.log(chalk.cyan("\n  Step E: Tagging successful consolidation (SemVer)..."));
        try {
            // 1. Get the latest existing tag with the defined prefix
            const latestTag = await this.gitService.getLatestSemverTag(this.projectRoot, TAG_PREFIX);

            let major = 0;
            let minor = 1;
            let patch = 0;

            // 2. Parse the latest tag if it exists
            if (latestTag) {
                 // Extract version string after prefix
                const versionPart = latestTag.substring(TAG_PREFIX.length);
                const versionMatch = versionPart.match(/^(\d+)\.(\d+)\.(\d+)$/);
                if (versionMatch) {
                    major = parseInt(versionMatch[1], 10);
                    minor = parseInt(versionMatch[2], 10);
                    patch = parseInt(versionMatch[3], 10);
                    console.log(chalk.dim(`    Parsed latest tag ${latestTag} as v${major}.${minor}.${patch}`));
                    // 3. Increment the patch version
                    patch++;
                } else {
                    console.warn(chalk.yellow(`    Could not parse SemVer from latest tag '${latestTag}'. Starting from v0.1.0.`));
                    // Reset to default starting version if parsing fails
                    major = 0;
                    minor = 1;
                    patch = 0;
                }
            } else {
                console.log(chalk.dim(`    No previous tag found. Starting with v0.1.0.`));
                // Start at v0.1.0 if no tags exist
                major = 0;
                minor = 1;
                patch = 0;
            }

            // 4. Construct the new tag name
            const newTagName = `${TAG_PREFIX}${major}.${minor}.${patch}`;

            // 5. Generate tag message
            const tagMessage = `Kai Auto-Tag: Successful consolidation for conversation '${conversationName}'`;

            // 6. Call GitService to create the tag
            await this.gitService.createAnnotatedTag(this.projectRoot, newTagName, tagMessage);

            await this._logSystemMessage(conversationFilePath, `System: Successfully created Git tag '${newTagName}'.`);

        } catch (tagError: any) {
             // Log the tagging error to the conversation file, but don't stop the overall success marker
             const errorMsg = `Failed to create Git tag after successful consolidation: ${tagError.message}`;
             console.error(chalk.red(`  Tagging Step Failed: ${errorMsg}`));
             await this._logError(conversationFilePath, `Tagging Warning: ${errorMsg}`);
             // Do not re-throw; allow consolidation to be marked successful even if tagging fails.
        }
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
                                 errorMessage.includes('Tagging Warning:') || // Add tag warning
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