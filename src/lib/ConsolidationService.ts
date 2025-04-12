// File: src/lib/ConsolidationService.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient'; // Correct import
import { Config } from './Config';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { GitService } from './GitService';
import { ConsolidationPrompts } from './prompts';
import { ConsolidationReviewer } from './ConsolidationReviewer';
import { ConsolidationGenerator } from './ConsolidationGenerator';
import { ConsolidationApplier } from './ConsolidationApplier'; // <-- ADD THIS IMPORT

// Define FinalFileStates interface here (keep export)
export interface FinalFileStates {
    [filePath: string]: string | 'DELETE_CONFIRMED';
}

// Keep ConsolidationAnalysis interface (keep export)
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
    private consolidationApplier: ConsolidationApplier; // <-- ADD THIS INSTANCE VARIABLE

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
        // <-- INSTANTIATE ConsolidationApplier HERE -->
        this.consolidationApplier = new ConsolidationApplier(this.fs); // Pass FileSystem
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

            // Step B: Generation (Delegated to ConsolidationGenerator)
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

            // Step C: Review Changes (Delegated)
            const applyChanges = await this.consolidationReviewer.reviewChanges(finalStates, this.projectRoot);

            // Step D: Apply Changes (Delegated to ConsolidationApplier)
             if (applyChanges) {
                console.log(chalk.cyan("\n  Step D: Applying approved changes..."));
                // <-- CALL THE NEW APPLIER SERVICE -->
                const { success, failed, skipped, summary } = await this.consolidationApplier.apply(
                    finalStates,
                    this.projectRoot
                    // No need to pass conversationFilePath here if logging is handled outside
                );
                // <-- END CALL -->

                // Log the summary to the conversation file
                try {
                    const title = failed > 0 ? 'Consolidation Apply Summary (with failures)' : 'Consolidation Apply Summary';
                    await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `${title}:\n${summary.join('\n')}` });
                } catch (logErr) {
                    console.warn(chalk.yellow("Warning: Could not log apply summary to conversation file."), logErr);
                }

                // Throw an error if the apply step had failures
                if (failed > 0) {
                    throw new Error(`Consolidation apply step completed with ${failed} failure(s). Please review the errors logged above.`);
                }

            } else {
                const msg = `System: Consolidation aborted by user. No changes applied.`;
                console.log(chalk.yellow("\n" + msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg });
            }

        } catch (error) {
            // Log the error that bubbles up from any step (including apply step)
            console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation: ${(error as Error).message}. See console for details.`;
            try {
                // Avoid duplicate logging for known, handled errors like Git status or the final apply summary error
                if (!(error instanceof Error && (
                    error.message.includes('Git working directory not clean') ||
                    error.message.includes('Failed to verify Git status') ||
                    error.message.includes('Git command not found') ||
                    error.message.includes('not a Git repository') ||
                    error.message.includes('Consolidation apply step completed with') // Avoid logging the final summary error message again
                    ))) {
                    const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                    await this.aiClient.logConversation(conversationFilePath, logPayload);
                }
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
            }
        }
    }

    // --- analyzeConversationForChanges (Remains Unchanged) ---
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
                    console.warn(chalk.yellow(`  Warning: Invalid operation structure found in analysis: filePath=${op.filePath}, action=${op.action}. Skipping operation.`));
                    // Consider filtering out invalid ops here instead of letting them proceed
                 }
                // Ensure filePath is normalized relative path
                op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
            }

             // Filter out operations with missing filePaths after normalization/warning
             const validOperations = analysis.operations.filter(op => op.filePath);
             if(validOperations.length !== analysis.operations.length){
                 console.warn(chalk.yellow(`  Warning: Filtered out ${analysis.operations.length - validOperations.length} invalid operations from analysis.`));
             }
             analysis.operations = validOperations;


            console.log(chalk.cyan(`    Analysis received from ${modelName}. Found ${analysis.operations.length} valid operations.`));
            return analysis;

        } catch (error) {
            const errorMsg = `Failed to analyze conversation using ${modelName}. Error: ${(error as Error).message}`;
            console.error(chalk.red(`    ${errorMsg}`));
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            throw new Error(errorMsg); // Rethrow to stop consolidation
        }
    }
}