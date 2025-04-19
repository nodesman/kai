// File: src/lib/consolidation/ConsolidationAnalyzer.ts
import path from 'path';
import chalk from 'chalk';
import { AIClient, LogEntryData } from '../AIClient';
// import Conversation, { Message } from '../models/Conversation'; // <-- Remove Conversation import
import { Message } from '../models/Conversation'; // <-- Import Message directly
import { ConsolidationPrompts } from './prompts';
import { ConsolidationAnalysis } from './types';

export class ConsolidationAnalyzer {
    private aiClient: AIClient;

    constructor(aiClient: AIClient) {
        this.aiClient = aiClient;
    }

    /**
     * Analyzes the relevant conversation history slice against the code context.
     * @param relevantHistory The relevant slice of conversation messages. // <-- UPDATED Doc
     * @param codeContext The current codebase context string.
     * @param conversationFilePath Path to the conversation log file for logging errors/warnings.
     * @param useFlashModel Whether to use the faster/cheaper model for analysis.
     * @param modelName The name of the model being used (for logging).
     * @returns A promise resolving to the ConsolidationAnalysis object.
     * @throws An error if the analysis fails or returns invalid data.
     */
    async analyze(
        relevantHistory: Message[], // <-- UPDATED Signature
        codeContext: string,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string
    ): Promise<ConsolidationAnalysis> {
        console.log(chalk.cyan(`    Requesting analysis from ${modelName}...`));
        // --- Build history string from the relevant slice ---
        const historyString = relevantHistory
            .map((m: Message) => `${m.role}:\n${m.content}\n---\n`)
            .join('');
        // --- End history string build ---

        const analysisPrompt = ConsolidationPrompts.analysisPrompt(codeContext, historyString);

        try {
            // Step 1: Get Raw AI Response
            const responseTextRaw = await this._callAnalysisAI(analysisPrompt, useFlashModel);

            // Step 2: Parse and Clean Response
            const analysis = this._parseAndCleanAnalysisResponse(responseTextRaw, modelName);

            // Step 3: Validate and Normalize Operations
            analysis.operations = this._validateAndNormalizeOperations(analysis.operations);

            console.log(chalk.cyan(`    Analysis received from ${modelName}. Found ${analysis.operations.length} valid operations.`));
            return analysis;

        } catch (error) {
            const errorMsg = `Failed to analyze conversation using ${modelName}. Error: ${(error as Error).message}`;
            console.error(chalk.red(`    ${errorMsg}`));
            await this._logError(conversationFilePath, errorMsg);
            throw new Error(errorMsg); // Rethrow to stop consolidation in the caller
        }
    }

    /**
     * Calls the AI client to get the raw analysis response.
     * @param analysisPrompt The prompt string for the AI.
     * @param useFlashModel Whether to use the flash model.
     * @returns The raw response text from the AI.
     * @throws An error if the AI call fails.
     */
    private async _callAnalysisAI(analysisPrompt: string, useFlashModel: boolean): Promise<string> {
        return this.aiClient.getResponseTextFromAI(
            [{ role: 'user', content: analysisPrompt }],
            useFlashModel
        );
    }

    /**
     * Cleans the raw AI response, extracts JSON, and parses it.
     * @param responseTextRaw The raw text response from the AI.
     * @param modelName The model name (for error messages).
     * @returns The parsed ConsolidationAnalysis object.
     * @throws An error if parsing or validation fails.
     */
    private _parseAndCleanAnalysisResponse(responseTextRaw: string, modelName: string): ConsolidationAnalysis {
        let responseTextClean = responseTextRaw.trim();
        const jsonMatch = responseTextClean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);

        if (jsonMatch && jsonMatch[1]) {
            responseTextClean = jsonMatch[1].trim();
        } else if (responseTextClean.startsWith('{') && responseTextClean.endsWith('}')) {
            // Assume raw JSON
        } else {
            throw new Error(`Analysis response from ${modelName} was not in the expected JSON format. Raw: ${responseTextRaw}`);
        }

        try {
            const analysis: ConsolidationAnalysis = JSON.parse(responseTextClean);
            // Basic structure validation
            if (!analysis || !Array.isArray(analysis.operations)) {
                throw new Error(`Invalid JSON structure received from ${modelName}. Expected { "operations": [...] }. Received: ${responseTextClean}`);
            }
            return analysis;
        } catch (parseError) {
            throw new Error(`Failed to parse JSON analysis from ${modelName}. Error: ${(parseError as Error).message}. Raw: ${responseTextClean}`);
        }
    }

    /**
     * Validates individual operations, normalizes file paths, and filters invalid operations.
     * @param operations The raw array of operations from the parsed AI response.
     * @returns A filtered array containing only valid and normalized operations.
     */
    private _validateAndNormalizeOperations(
        operations: ConsolidationAnalysis['operations']
    ): ConsolidationAnalysis['operations'] {
        const validOperations: ConsolidationAnalysis['operations'] = [];
        for (const op of operations) {
            // Check required fields and valid action type
            if (!op.filePath || typeof op.filePath !== 'string' || !op.action || !['CREATE', 'MODIFY', 'DELETE'].includes(op.action)) {
                console.warn(chalk.yellow(`  Warning: Invalid operation structure found in analysis: filePath=${op.filePath}, action=${op.action}. Skipping operation.`));
                continue;
            }

            // Ensure filePath is normalized relative path and not empty after normalization
            op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
            if (!op.filePath) {
                console.warn(chalk.yellow(`  Warning: Operation file path became empty after normalization. Skipping operation.`));
                continue;
            }
            validOperations.push(op);
        }
        return validOperations;
    }

    /**
     * Logs an error message to the conversation file.
     * @param conversationFilePath The path to the conversation log file.
     * @param errorMsg The error message to log.
     */
    private async _logError(conversationFilePath: string, errorMsg: string): Promise<void> {
        try {
            await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
        } catch (logErr) {
            console.error(chalk.red("Additionally failed to log analysis error:"), logErr);
        }
    }
}