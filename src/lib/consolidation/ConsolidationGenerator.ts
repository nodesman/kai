// File: src/lib/consolidation/ConsolidationGenerator.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from '../FileSystem';
import { AIClient, LogEntryData } from '../AIClient';
import { Config } from '../Config';
import Conversation, { Message } from '../models/Conversation';
import { ConsolidationPrompts } from './prompts';
import { FinalFileStates, ConsolidationAnalysis } from './types';

export class ConsolidationGenerator {
    private config: Config;
    private fileSystem: FileSystem;
    private aiClient: AIClient;
    private projectRoot: string;

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
    }

    /**
     * Generates the final proposed content or deletion status for each file based on analysis.
     * @param conversation The conversation history.
     * @param codeContext The current codebase context string.
     * @param analysisResult The result from the analysis step.
     * @param conversationFilePath Path to the conversation log file for logging errors/warnings.
     * @param useFlashModel Whether to use the faster/cheaper model for generation.
     * @param modelName The name of the model being used (for logging).
     * @returns A promise resolving to the FinalFileStates object.
     */
    async generate(
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
            // Generate content for each required file
            for (const filePath of filesToGenerate) {
                await this._generateContentForFile(
                    filePath,
                    finalStates,
                    codeContext,
                    historyString,
                    useFlashModel,
                    modelName,
                    conversationFilePath // Pass for logging within the helper
                );
            }
        }

        // Apply delete operations from analysis after generation is complete
        await this._applyAnalysisDeletes(finalStates, analysisResult, conversationFilePath);

        return finalStates;
    }

    /**
     * Generates content for a single file, including reading current state, calling AI with retry,
     * parsing response, and updating finalStates.
     */
    private async _generateContentForFile(
        filePath: string,
        finalStates: FinalFileStates,
        codeContext: string,
        historyString: string,
        useFlashModel: boolean,
        modelName: string,
        conversationFilePath: string // For logging errors
    ): Promise<void> {
        const normalizedPath = path.normalize(filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
        console.log(chalk.cyan(`      Generating content for: ${normalizedPath}`));
        let attempt = 0; // For logging in catch block

        try {
            // Step 1: Read current file content (if exists)
            const currentContent = await this._readCurrentFileContent(normalizedPath);

            // Step 2: Build the prompt for this specific file
            const individualPrompt = ConsolidationPrompts.individualFileGenerationPrompt(
                codeContext,
                historyString,
                normalizedPath,
                currentContent
            );

            // Step 3: Call AI with retry logic
            const responseTextRaw = await this._callGenerationAIWithRetry(
                individualPrompt,
                normalizedPath,
                useFlashModel
            );

            // Step 4: Parse the response (handle DELETE_FILE, remove fences)
            const finalContentOrDelete = this._parseGenerationAIResponse(
                responseTextRaw,
                normalizedPath,
                conversationFilePath // For logging DELETE suggestion
            );

            // Step 5: Update finalStates
            finalStates[normalizedPath] = finalContentOrDelete;
            if (finalContentOrDelete === 'DELETE_CONFIRMED') {
                console.log(chalk.yellow(`      AI suggested DELETE for ${normalizedPath}. Marked for deletion.`));
            } else {
                console.log(chalk.green(`      Successfully generated content for ${normalizedPath} (Length: ${finalContentOrDelete.length})`));
            }

        } catch (error) { // Catches errors from steps above
            const errorMsg = `Failed to generate content for ${normalizedPath} using ${modelName} after ${attempt + 1} attempts. Error: ${(error as Error).message}`;
            console.error(chalk.red(`      ${errorMsg}`));
            await this._logError(conversationFilePath, errorMsg);
            // Skipping file on error for now
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
        prompt: string,
        filePathForLog: string, // For logging purposes
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
                // Success, the return above exits the loop
            } catch (aiError: any) {
                // Determine if retryable (simplified check)
                const isRetryable = aiError.message?.toLowerCase().includes('rate limit') ||
                                    aiError.message?.includes('500') ||
                                    aiError.message?.includes('503') ||
                                    aiError.message?.toLowerCase().includes('retry');

                if (isRetryable && attempt < maxAttempts) {
                    attempt++;
                    const delay = baseDelay * Math.pow(2, attempt - 1);
                    console.warn(chalk.yellow(`        AI Error for ${filePathForLog} (Attempt ${attempt}/${maxAttempts + 1}): ${aiError.message}. Retrying in ${delay / 1000}s...`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(chalk.red(`        Failed AI call for ${filePathForLog} after ${attempt + 1} attempts.`));
                    throw aiError; // Non-retryable or max attempts reached
                }
            }
        }
        // Should be unreachable if maxAttempts >= 0, but satisfies TS compiler
        throw new Error(`Failed to get AI response for ${filePathForLog} after ${maxAttempts + 1} attempts.`);
    }

    /** Parses the raw AI response, handling DELETE_FILE and markdown fences. */
    private _parseGenerationAIResponse(
        responseTextRaw: string,
        normalizedPath: string,
        conversationFilePath: string // Required for logging
    ): string | 'DELETE_CONFIRMED' {
        let responseTextClean = responseTextRaw.trim();

        if (responseTextClean === "DELETE_FILE") {
            // Log the AI's suggestion to delete
            this._logSystemMessage(conversationFilePath, `System: AI suggested DELETE for ${normalizedPath} during individual generation.`);
            return 'DELETE_CONFIRMED';
        }

        // Check and remove markdown fences
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
        conversationFilePath: string // For logging overrides
    ): Promise<void> {
        for (const op of analysisResult.operations) {
            if (op.action === 'DELETE') {
                const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                if (!(normalizedPath in finalStates)) {
                    // If not already handled by generation (e.g., AI returned DELETE_FILE), mark it now.
                    console.log(chalk.dim(`      Marking DELETE for ${normalizedPath} based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                } else if (finalStates[normalizedPath] !== 'DELETE_CONFIRMED') {
                    // If generation produced content but analysis said delete, analysis wins.
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