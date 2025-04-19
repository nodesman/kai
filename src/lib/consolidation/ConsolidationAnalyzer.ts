// File: src/lib/consolidation/ConsolidationAnalyzer.ts
import path from 'path';
import chalk from 'chalk';
import { AIClient, LogEntryData } from '../AIClient';
import { Message } from '../models/Conversation'; // Import Message directly
import { ConsolidationPrompts } from './prompts';
import { ConsolidationAnalysis } from './types';

// --- ADDED: Looser type definition for raw operations before validation ---
type RawOperationFromAI = {
    filePath?: string; // Allow optional filePath
    file_path?: string; // Allow optional file_path
    action?: 'CREATE' | 'MODIFY' | 'DELETE' | string; // Allow action as string initially
    // Allow other potential fields the AI might mistakenly add
    [key: string]: any;
}

export class ConsolidationAnalyzer {
    private aiClient: AIClient;

    constructor(aiClient: AIClient) {
        this.aiClient = aiClient;
    }

    /**
     * Analyzes the relevant conversation history slice against the code context.
     * @param relevantHistory The relevant slice of conversation messages.
     * @param codeContext The current codebase context string.
     * @param conversationFilePath Path to the conversation log file for logging errors/warnings.
     * @param useFlashModel Whether to use the faster/cheaper model for analysis.
     * @param modelName The name of the model being used (for logging).
     * @returns A promise resolving to the ConsolidationAnalysis object.
     * @throws An error if the analysis fails or returns invalid data.
     */
    async analyze(
        relevantHistory: Message[],
        codeContext: string,
        conversationFilePath: string,
        useFlashModel: boolean,
        modelName: string
    ): Promise<ConsolidationAnalysis> {
        console.log(chalk.cyan(`    Requesting analysis from ${modelName}...`));
        const historyString = relevantHistory
            .map((m: Message) => `${m.role}:\n${m.content}\n---\n`)
            .join('');

        const analysisPrompt = ConsolidationPrompts.analysisPrompt(codeContext, historyString);

        // --- FIX 1: Declare responseTextRaw outside the try block ---
        let responseTextRaw: string = '';

        try {
            // Step 1: Get Raw AI Response
            responseTextRaw = await this._callAnalysisAI(analysisPrompt, useFlashModel); // Assign here

            // Step 2: Parse and Adapt Response (Handles array vs object)
            const analysis = this._parseAndAdaptAnalysisResponse(responseTextRaw, modelName);

            // Step 3: Validate and Normalize Operations (Accepts looser type, returns strict type)
            analysis.operations = this._validateAndNormalizeOperations(analysis.operations as RawOperationFromAI[]); // Cast input here

            console.log(chalk.cyan(`    Analysis received from ${modelName}. Found ${analysis.operations.length} valid operations.`));
            return analysis; // Returns the strict ConsolidationAnalysis type

        } catch (error) {
            // Log the raw response text if the error message indicates a parsing issue
            let errorMessage = `Failed to analyze conversation using ${modelName}. Error: ${(error as Error).message}`;
            // --- FIX 1: responseTextRaw is now accessible here ---
            if ((errorMessage.includes("Failed to parse JSON") || errorMessage.includes("Invalid JSON structure")) && responseTextRaw) {
                errorMessage += `. Raw: ${responseTextRaw}`; // Append raw response for easier debugging
            }
            const errorMsg = errorMessage;
            console.error(chalk.red(`    ${errorMsg}`));
            await this._logError(conversationFilePath, errorMsg); // Log the potentially extended error message
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
     * Cleans the raw AI response, extracts JSON, parses it, and adapts the structure if needed.
     * Handles cases where the AI returns just the array `[...]` instead of `{"operations": [...]}`.
     * @param responseTextRaw The raw text response from the AI.
     * @param modelName The model name (for error messages).
     * @returns The parsed and potentially adapted ConsolidationAnalysis object. The 'operations' array might contain looser types at this stage.
     * @throws An error if parsing or validation fails.
     */
    private _parseAndAdaptAnalysisResponse(responseTextRaw: string, modelName: string): ConsolidationAnalysis {
        let responseTextClean = responseTextRaw.trim();
        const jsonMatch = responseTextClean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);

        if (jsonMatch && jsonMatch[1]) {
            responseTextClean = jsonMatch[1].trim();
        } else if (responseTextClean.startsWith('{') && responseTextClean.endsWith('}')) {
            // Assume raw JSON object
        } else if (responseTextClean.startsWith('[') && responseTextClean.endsWith(']')) {
            // Assume raw JSON array - THIS IS THE NEW CASE TO HANDLE
            console.log(chalk.dim(`      Received raw JSON array from ${modelName}. Attempting to adapt.`));
        }
        else {
            // Throw error only if it doesn't look like JSON at all or isn't wrapped in fences
            throw new Error(`Analysis response from ${modelName} was not in a recognizable JSON format (object/array, optional fences).`);
        }

        try {
            const parsedData = JSON.parse(responseTextClean);
            let analysis: ConsolidationAnalysis; // Still aims for the target structure

            // --- ADAPTATION LOGIC ---
            if (Array.isArray(parsedData)) {
                // If the AI returned just the array, wrap it in the expected structure
                console.log(chalk.dim(`      Adapting raw array response into {"operations": [...]}`));
                // The elements within parsedData might still have file_path at this point
                analysis = { operations: parsedData };
            } else if (parsedData && typeof parsedData === 'object' && Array.isArray(parsedData.operations)) {
                // If the AI returned the correct object structure
                // The elements within parsedData.operations might still have file_path
                analysis = parsedData as ConsolidationAnalysis; // Cast, validation happens next
            } else {
                // If it's an object but doesn't have the 'operations' array
                throw new Error(`Invalid JSON structure received from ${modelName}. Expected { "operations": [...] } or just [...]. Received: ${responseTextClean}`);
            }
            // --- END ADAPTATION LOGIC ---

            // Basic structure validation *after* potential adaptation
            if (!analysis || !Array.isArray(analysis.operations)) {
                throw new Error(`Invalid final JSON structure after parsing/adaptation. Expected { "operations": [...] }. Result: ${JSON.stringify(analysis)}`);
            }
            // Note: analysis.operations might contain RawOperationFromAI types here,
            // they get strictly validated in the next step.
            return analysis;
        } catch (parseError) {
            throw new Error(`Failed to parse JSON analysis from ${modelName}. Error: ${(parseError as Error).message}`);
        }
    }

    /**
     * Validates individual operations, normalizes file paths, and filters invalid operations.
     * Handles both `filePath` and `file_path` keys from the potentially raw input.
     * @param operations The potentially raw array of operations from the parsed AI response.
     * @returns A filtered array containing only valid and normalized operations matching the strict ConsolidationAnalysis['operations'] type.
     */
    // --- FIX 2: Update signature and internal logic ---
    private _validateAndNormalizeOperations(
        operations: RawOperationFromAI[] // Accept the looser type as input
    ): ConsolidationAnalysis['operations'] { // Return the stricter type
        const validOperations: ConsolidationAnalysis['operations'] = []; // Holds strictly typed results
        if (!Array.isArray(operations)) {
            console.warn(chalk.yellow(`  Warning: 'operations' is not an array after parsing/adaptation. Skipping validation.`));
            return []; // Return empty if structure is fundamentally wrong
        }

        for (const op of operations) { // op is RawOperationFromAI here
            if (typeof op !== 'object' || op === null) {
                console.warn(chalk.yellow(`  Warning: Invalid item found in operations array: ${JSON.stringify(op)}. Skipping.`));
                continue;
            }

            // Safely check for both filePath and file_path
            const filePathValue = typeof op.filePath === 'string' ? op.filePath : typeof op.file_path === 'string' ? op.file_path : undefined;
            const actionValue = typeof op.action === 'string' ? op.action : undefined;

            // Check required fields and valid action type ('CREATE', 'MODIFY', 'DELETE')
            if (!filePathValue || !actionValue || !['CREATE', 'MODIFY', 'DELETE'].includes(actionValue)) {
                console.warn(chalk.yellow(`  Warning: Invalid operation structure found in analysis: Path='${filePathValue}', Action='${actionValue}'. Skipping operation.`));
                continue;
            }

            // Normalize path and store consistently using 'filePath'
            const normalizedPath = path.normalize(filePathValue).replace(/^[\\\/]+|[\\\/]+$/g, '');
            if (!normalizedPath) {
                console.warn(chalk.yellow(`  Warning: Operation file path became empty after normalization ('${filePathValue}'). Skipping operation.`));
                continue;
            }

            // Add the validated and normalized operation using the standard structure
            // Ensure the object pushed matches the strict ConsolidationAnalysis['operations'][number] type
            validOperations.push({
                filePath: normalizedPath, // Use consistent key
                action: actionValue as 'CREATE' | 'MODIFY' | 'DELETE' // Type assertion is safe after validation
            });
        }
        return validOperations; // Return the array of strictly typed operations
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