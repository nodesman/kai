// File: src/lib/consolidation/ConsolidationGenerator.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from '../FileSystem'; // Adjusted path
import { AIClient, LogEntryData } from '../AIClient'; // Adjusted path
import { Config } from '../Config'; // Adjusted path
import Conversation, { Message } from '../models/Conversation'; // Adjusted path
import { ConsolidationPrompts } from './prompts'; // Adjusted path
import { FinalFileStates, ConsolidationAnalysis } from './types'; // Adjusted path

export class ConsolidationGenerator {
    private config: Config;
    private fileSystem: FileSystem; // Renamed to avoid clash with internal 'fs' usage if any
    private aiClient: AIClient;
    private projectRoot: string;

    constructor(
        config: Config,
        fileSystem: FileSystem,
        aiClient: AIClient,
        projectRoot: string // Pass projectRoot if needed for path resolution
    ) {
        this.config = config;
        this.fileSystem = fileSystem;
        this.aiClient = aiClient;
        this.projectRoot = projectRoot; // Store projectRoot
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

            let attempt = 0; // Define attempt here to use it in catch block below
            for (const filePath of filesToGenerate) {
                const normalizedPath = path.normalize(filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                console.log(chalk.cyan(`      Generating content for: ${normalizedPath}`));

                try {
                    let currentContent: string | null = null;
                    try {
                        // Use the injected fileSystem instance and projectRoot
                        currentContent = await this.fileSystem.readFile(path.resolve(this.projectRoot, normalizedPath));
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
                             // Use the injected aiClient instance
                             responseTextRaw = await this.aiClient.getResponseTextFromAI(
                                 [{ role: 'user', content: individualPrompt }],
                                 useFlashModel
                             );
                             break; // Success, exit loop
                         } catch (aiError: any) {
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
                        // Use the injected aiClient instance
                        await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: AI suggested DELETE for ${normalizedPath} during individual generation.` });
                    } else {
                        finalStates[normalizedPath] = responseTextClean;
                        console.log(chalk.green(`      Successfully generated content for ${normalizedPath} (Length: ${responseTextClean.length})`));
                    }

                } catch (error) { // Catch errors from the retry block or non-retryable ones
                    const errorMsg = `Failed to generate content for ${normalizedPath} using ${modelName} after ${attempt + 1} attempts. Error: ${(error as Error).message}`;
                    console.error(chalk.red(`      ${errorMsg}`));
                     // Use the injected aiClient instance
                    await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
                    // Skipping file on error for now
                }
            }
        }

        // Handle DELETE actions from analysis that weren't generated (or overridden by generation)
        for (const op of analysisResult.operations) {
            if (op.action === 'DELETE') {
                const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                if (!(normalizedPath in finalStates)) {
                    console.log(chalk.dim(`      Marking DELETE for ${normalizedPath} based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                } else if (finalStates[normalizedPath] !== 'DELETE_CONFIRMED') {
                    console.warn(chalk.yellow(`      Warning: ${normalizedPath} was marked DELETE in analysis, but generation step provided content. Prioritizing DELETE based on analysis.`));
                    finalStates[normalizedPath] = 'DELETE_CONFIRMED';
                     // Use the injected aiClient instance
                    await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `System: Overriding generated content for ${normalizedPath} with DELETE based on analysis.` });
                }
            }
        }

        return finalStates;
    }
}