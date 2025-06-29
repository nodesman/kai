// File: src/lib/consolidation/ConsolidationGenerator.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from '../FileSystem';
import { AIClient, LogEntryData } from '../AIClient';
import { Config } from '../Config'; // Keep Config
// import Conversation, { Message } from '../models/Conversation'; // <-- Remove Conversation import
import { Message } from '../models/Conversation'; // <-- Import Message directly
import { ConsolidationPrompts } from './prompts';
import { FinalFileStates, ConsolidationAnalysis } from './types';
import { HIDDEN_CONSOLIDATION_GENERATION_INSTRUCTION } from '../internal_prompts'; // Import hidden instruction

export class ConsolidationGenerator {
    private config: Config;
    private fileSystem: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;
    // *** REMOVED: hiddenConsolidationInstruction property and loading logic ***

    constructor(
        config: Config,
        fileSystem: FileSystem,
        aiClient: AIClient,
        projectRoot: string
    ) {
        this.config = config;
        this.fileSystem = fileSystem;
        this.aiClient = aiClient;
        this.projectRoot = projectRoot;
        // *** REMOVED: _loadHiddenConsolidationInstruction call ***
    }

    /**
     * Allows updating the AI client after construction.
     */
    setAIClient(aiClient: AIClient): void {
        this.aiClient = aiClient;
    }
    // *** REMOVED: _loadHiddenConsolidationInstruction method ***

    /**
     * Generates the final proposed content or deletion status for each file based on analysis
     * and the relevant history slice.
     * @param relevantHistory The relevant slice of conversation messages. // <-- UPDATED Doc
     * @param codeContext The current codebase context string.
     * @param analysisResult The result from the analysis step.
     * @param conversationFilePath Path to the conversation log file for logging errors/warnings.
     * @param useFlashModel Whether to use the faster/cheaper model for generation.
     * @param modelName The name of the model being used (for logging).
     * @returns A promise resolving to the FinalFileStates object.
     */
    async generate(
        relevantHistory: Message[], // <-- Signature already updated previously
        codeContext: string,
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string
    ): Promise<FinalFileStates> {
        const finalStates: FinalFileStates = {};
        // --- Build history string from the relevant slice ---
        const historyString = relevantHistory
            .map((m: Message) => `${m.role}:\n${m.content}\n---\n`)
            .join('');
        // --- End history string build ---

        const filesToGenerate = analysisResult.operations
            .filter(op => op.action === 'CREATE' || op.action === 'MODIFY')
            .map(op => op.filePath);

        if (filesToGenerate.length === 0) {
            console.log(chalk.yellow("    No files require content generation based on analysis."));
        } else {
            console.log(chalk.cyan(`    Generating content for ${filesToGenerate.length} file(s) individually using ${modelName}...`));
            for (const filePath of filesToGenerate) {
                await this._generateContentForFile(
                    filePath,
                    finalStates,
                    codeContext,
                    historyString, // Pass the potentially sliced history string
                    useFlashModel,
                    modelName,
                    conversationFilePath
                );
            }
        }

        // Apply delete operations from analysis (remains same)
        await this._applyAnalysisDeletes(finalStates, analysisResult, conversationFilePath);

        return finalStates;
    }

    private async _generateContentForFile(
        filePath: string,
        finalStates: FinalFileStates,
        codeContext: string,
        historyString: string, // Receives potentially sliced history string
        useFlashModel: boolean,
        modelName: string,
        conversationFilePath: string
    ): Promise<void> {
        const normalizedPath = path.normalize(filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
        console.log(chalk.cyan(`      Generating content for: ${normalizedPath}`));
        const currentContent = await this._readCurrentFileContent(normalizedPath);

        // Build the base prompt (using potentially sliced history)
        const basePrompt = ConsolidationPrompts.individualFileGenerationPrompt(
            codeContext,
            historyString, // Use the passed history string
            normalizedPath,
            currentContent
        );

        // Prepend the hidden instruction directly from import
        const finalPromptToSend = `${HIDDEN_CONSOLIDATION_GENERATION_INSTRUCTION}\n\n---\n\n${basePrompt}`;
        console.log(chalk.dim("      Prepended hidden generation instruction (not logged)."));

        const maxAttempts = this.config.gemini.generation_max_retries ?? 3;
        let attempt = 0;

        try {
            while (attempt <= maxAttempts) {
                const responseTextRaw = await this._callGenerationAIWithRetry(
                    finalPromptToSend,
                    normalizedPath,
                    useFlashModel
                );

                const finalContentOrDelete = this._parseGenerationAIResponse(
                    responseTextRaw,
                    normalizedPath,
                    conversationFilePath
                );

                if (finalContentOrDelete !== 'DELETE_CONFIRMED' && finalContentOrDelete.length === 0) {
                    if (attempt < maxAttempts) {
                        attempt++;
                        console.warn(chalk.yellow(`      Empty content generated for ${normalizedPath}. Retrying (${attempt}/${maxAttempts})...`));
                        continue;
                    } else {
                        throw new Error('AI returned empty content');
                    }
                }

                finalStates[normalizedPath] = finalContentOrDelete;
                if (finalContentOrDelete === 'DELETE_CONFIRMED') {
                    console.log(chalk.yellow(`      AI suggested DELETE for ${normalizedPath}. Marked for deletion.`));
                } else {
                    console.log(chalk.green(`      Successfully generated content for ${normalizedPath} (${finalContentOrDelete.length} characters)`));
                }
                break;
            }

        } catch (error) {
            const errorMsg = `Failed to generate content for ${normalizedPath} using ${modelName} after ${attempt + 1} attempts. Error: ${(error as Error).message}`;
            console.error(chalk.red(`      ${errorMsg}`));
            await this._logError(conversationFilePath, errorMsg);
        }
    }

    /** Reads the current content of a file, handling ENOENT. */
    private async _readCurrentFileContent(normalizedPath: string): Promise<string | null> {
        try {
            return await this.fileSystem.readFile(path.resolve(this.projectRoot, normalizedPath));
        } catch (e) {
             if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // Rethrow unexpected errors
             return null; // File doesn't exist
        }
    }

    /** Calls the AI to generate file content, with retry logic. */
    private async _callGenerationAIWithRetry(
        prompt: string, // Accepts the full prompt including hidden instructions
        filePathForLog: string,
        useFlashModel: boolean
    ): Promise<string> {
        let attempt = 0;
        const maxAttempts = this.config.gemini.generation_max_retries ?? 3;
        const baseDelay = this.config.gemini.generation_retry_base_delay_ms ?? 2000;

        while (attempt <= maxAttempts) {
            try {
                console.log(chalk.dim(`        (Attempt ${attempt + 1}/${maxAttempts + 1}) Calling AI for ${filePathForLog}...`));
                return await this.aiClient.getResponseTextFromAI(
                    [{ role: 'user', content: prompt }],
                    useFlashModel
                );
            } catch (aiError: any) {
                 const isRetryable = aiError.message?.toLowerCase().includes('rate limit') ||
                                 aiError.message?.includes('500') ||
                                 aiError.message?.includes('503') ||
                                 aiError.message?.toLowerCase().includes('retry') ||
                                 (aiError.code && ['RATE_LIMIT', 'SERVER_OVERLOADED', 'NETWORK_ERROR', 'NO_RESPONSE'].includes(aiError.code));

                 if (isRetryable && attempt < maxAttempts) {
                     attempt++;
                     const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
                     console.warn(chalk.yellow(`        AI Error for ${filePathForLog} (Attempt ${attempt}/${maxAttempts + 1}): ${aiError.message || aiError.code}. Retrying in ${(delay / 1000).toFixed(1)}s...`));
                     await new Promise(resolve => setTimeout(resolve, delay));
                 } else {
                     console.error(chalk.red(`        Failed AI call for ${filePathForLog} after ${attempt + 1} attempts.`));
                     throw aiError;
                 }
            }
        }
        throw new Error(`Failed to get AI response for ${filePathForLog} after ${maxAttempts + 1} attempts.`);
    }

    /** Parses the raw AI response, handling DELETE_FILE and markdown fences. */
    private _parseGenerationAIResponse(
        responseTextRaw: string,
        normalizedPath: string,
        conversationFilePath: string
    ): string | 'DELETE_CONFIRMED' {
        let responseTextClean = responseTextRaw.trim();

         if (responseTextClean === "DELETE_FILE") {
             this._logSystemMessage(conversationFilePath, `System: AI suggested DELETE for ${normalizedPath} during individual generation.`);
             return 'DELETE_CONFIRMED';
         }

         const startsWithFence = responseTextClean.match(/^```(?:[\w-]+)?\s*\n/);
         const endsWithFence = responseTextClean.endsWith('\n```');

         if (startsWithFence && endsWithFence) {
             console.warn(chalk.yellow(`      Note: Removing markdown fences from AI response for ${normalizedPath}`));
             responseTextClean = responseTextClean.substring(startsWithFence[0].length, responseTextClean.length - 4).trim();
         } else if (startsWithFence || endsWithFence) {
             console.warn(chalk.yellow(`      Warning: Found partial markdown fence in AI response for ${normalizedPath}. Using content as is.`));
         }

         return responseTextClean;
    }

     /** Ensures DELETE operations from the analysis phase are applied, overriding generated content if necessary. */
     private async _applyAnalysisDeletes(
        finalStates: FinalFileStates,
        analysisResult: ConsolidationAnalysis,
        conversationFilePath: string
    ): Promise<void> {
         for (const op of analysisResult.operations) {
             if (op.action === 'DELETE') {
                 const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                 if (!(normalizedPath in finalStates)) {
                     console.log(chalk.dim(`      Marking DELETE for ${normalizedPath} based on analysis.`));
                     finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                 } else if (finalStates[normalizedPath] !== 'DELETE_CONFIRMED') {
                     console.warn(chalk.yellow(`      Warning: Overriding generated content for ${normalizedPath} with DELETE based on initial analysis.`));
                     finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                     await this._logSystemMessage(conversationFilePath, `System: Overriding generated content for ${normalizedPath} with DELETE based on analysis.`);
                 }
             }
         }
     }

     /** Logs an error message to the conversation file. */
     private async _logError(conversationFilePath: string, errorMsg: string): Promise<void> {
         try {
             await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
         } catch (logErr) {
             console.error(chalk.red("Additionally failed to log generation error:"), logErr);
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