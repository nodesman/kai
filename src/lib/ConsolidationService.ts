// File: src/lib/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient'; // Correct import
import { Config } from './Config';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { GitService } from './GitService';
// Removed ConsolidationPrompts import as it's now used by ConsolidationAnalyzer
import { ConsolidationReviewer } from './ConsolidationReviewer';
import { ConsolidationGenerator } from './ConsolidationGenerator';
import { ConsolidationApplier } from './ConsolidationApplier';
import { ConsolidationAnalyzer } from './ConsolidationAnalyzer'; // <-- ADD THIS IMPORT

// Define FinalFileStates interface here (keep export)
export interface FinalFileStates {
    [filePath: string]: string | 'DELETE_CONFIRMED';
}

// Keep ConsolidationAnalysis interface export (or move definition)
export interface ConsolidationAnalysis {
    operations: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE' }>;
    groups?: string[][];
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
    private consolidationAnalyzer: ConsolidationAnalyzer; // <-- ADD THIS INSTANCE VARIABLE

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
            this.config,
            this.fs,
            this.aiClient,
            this.projectRoot
        );
        this.consolidationApplier = new ConsolidationApplier(this.fs);
        this.consolidationAnalyzer = new ConsolidationAnalyzer(this.aiClient); // <-- INSTANTIATE HERE
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
            // Step 0: Git Check (Unchanged)
            console.log(chalk.blue("\n  Step 0: Checking Git status..."));
            try {
                await this.gitService.checkCleanStatus(this.projectRoot);
                console.log(chalk.green("  Proceeding with consolidation..."));
            } catch (gitError: any) {
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: gitError.message });
                throw gitError;
            }

            // Determine models (Unchanged)
            const useFlashForAnalysis = false;
            const useFlashForIndividualGeneration = false;
            const analysisModelName = useFlashForAnalysis ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            const generationModelName = useFlashForIndividualGeneration ? (this.config.gemini.subsequent_chat_model_name || 'Flash') : (this.config.gemini.model_name || 'Pro');
            console.log(chalk.cyan(`  (Using ${analysisModelName} for analysis, ${generationModelName} for individual file generation)`));

            // Step A: Analysis (Delegated to ConsolidationAnalyzer)
            console.log(chalk.cyan("\n  Step A: Analyzing conversation..."));
            // <-- CALL THE NEW ANALYZER SERVICE -->
            const analysisResult = await this.consolidationAnalyzer.analyze(
                conversation,
                currentContextString,
                conversationFilePath,
                useFlashForAnalysis,
                analysisModelName
            );
            // <-- END CALL -->

             if (!analysisResult || !analysisResult.operations || analysisResult.operations.length === 0) {
                console.log(chalk.yellow("  Analysis did not identify any specific file operations. Consolidation might be incomplete or unnecessary."));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found 0 ops. Aborting consolidation.` });
                return;
            }
            console.log(chalk.green(`  Analysis complete: Identified ${analysisResult.operations.length} operations.`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Analysis (using ${analysisModelName}) found ${analysisResult.operations.length} ops...` });

            // Step B: Generation (Unchanged - Delegated to ConsolidationGenerator)
            console.log(chalk.cyan("\n  Step B: Generating final file states individually..."));
            const finalStates = await this.consolidationGenerator.generate(
                conversation,
                currentContextString,
                analysisResult,
                conversationFilePath,
                useFlashForIndividualGeneration,
                generationModelName
            );
            console.log(chalk.green(`  Generation complete: Produced final states for ${Object.keys(finalStates).length} files.`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Generation (using ${generationModelName}) produced states for ${Object.keys(finalStates).length} files...` });

            // Step C: Review Changes (Unchanged - Delegated to ConsolidationReviewer)
            const applyChanges = await this.consolidationReviewer.reviewChanges(finalStates, this.projectRoot);

            // Step D: Apply Changes (Unchanged - Delegated to ConsolidationApplier)
             if (applyChanges) {
                console.log(chalk.cyan("\n  Step D: Applying approved changes..."));
                const { success, failed, skipped, summary } = await this.consolidationApplier.apply(
                    finalStates,
                    this.projectRoot
                );

                try {
                    const title = failed > 0 ? 'Consolidation Apply Summary (with failures)' : 'Consolidation Apply Summary';
                    await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `${title}:\n${summary.join('\n')}` });
                } catch (logErr) {
                    console.warn(chalk.yellow("Warning: Could not log apply summary to conversation file."), logErr);
                }

                if (failed > 0) {
                    throw new Error(`Consolidation apply step completed with ${failed} failure(s). Please review the errors logged above.`);
                }

            } else {
                const msg = `System: Consolidation aborted by user. No changes applied.`;
                console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg });
            }

        } catch (error) { // Error handling remains largely the same
            console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation: ${(error as Error).message}. See console for details.`;
            try {
                // Avoid duplicate logging for known, handled errors
                if (!(error instanceof Error && (
                    error.message.includes('Git working directory not clean') ||
                    error.message.includes('Failed to verify Git status') ||
                    error.message.includes('Git command not found') ||
                    error.message.includes('not a Git repository') ||
                    error.message.includes('Consolidation apply step completed with') ||
                    error.message.includes('Failed to analyze conversation using') // Avoid logging analysis error twice
                    ))) {
                    const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                    await this.aiClient.logConversation(conversationFilePath, logPayload);
                }
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
            }
        }
    }

    // --- REMOVED analyzeConversationForChanges METHOD ---
}