// File: src/lib/ConsolidationAnalyzer.ts
import path from 'path';
import chalk from 'chalk';
import { AIClient, LogEntryData } from './AIClient'; // Correct import
import Conversation, { Message } from './models/Conversation';
import { ConsolidationPrompts } from './prompts';
import { ConsolidationAnalysis } from './ConsolidationService'; // Import type from ConsolidationService (or move definition here/to types.ts)

export class ConsolidationAnalyzer {
    private aiClient: AIClient;

    constructor(aiClient: AIClient) {
        this.aiClient = aiClient;
    }

    /**
     * Analyzes the conversation history against the code context to identify file operations.
     * @param conversation The conversation history.
     * @param codeContext The current codebase context string.
     * @param conversationFilePath Path to the conversation log file for logging errors/warnings.
     * @param useFlashModel Whether to use the faster/cheaper model for analysis.
     * @param modelName The name of the model being used (for logging).
     * @returns A promise resolving to the ConsolidationAnalysis object.
     * @throws An error if the analysis fails or returns invalid data.
     */
    async analyze(
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
            // Use the injected AI Client
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

            // Validation of the parsed structure
            if (!analysis || !Array.isArray(analysis.operations)) {
                throw new Error(`Invalid JSON structure received from ${modelName}. Expected { "operations": [...] }. Received: ${responseTextClean}`);
            }

            // Normalize and validate individual operations
            const validOperations: ConsolidationAnalysis['operations'] = [];
            for (const op of analysis.operations) {
                if (!op.filePath || !op.action || !['CREATE', 'MODIFY', 'DELETE'].includes(op.action)) {
                    console.warn(chalk.yellow(`  Warning: Invalid operation structure found in analysis: filePath=${op.filePath}, action=${op.action}. Skipping operation.`));
                    continue; // Skip this invalid operation
                }
                // Ensure filePath is normalized relative path
                op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
                if (!op.filePath) { // Check if path became empty after normalization
                     console.warn(chalk.yellow(`  Warning: Operation file path became empty after normalization. Skipping operation.`));
                     continue;
                }
                validOperations.push(op);
            }

            // Update analysis.operations with only the valid ones
            analysis.operations = validOperations;

            console.log(chalk.cyan(`    Analysis received from ${modelName}. Found ${analysis.operations.length} valid operations.`));
            return analysis;

        } catch (error) {
            const errorMsg = `Failed to analyze conversation using ${modelName}. Error: ${(error as Error).message}`;
            console.error(chalk.red(`    ${errorMsg}`));
            // Use the injected AI Client to log
            try {
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log analysis error:"), logErr);
            }
            throw new Error(errorMsg); // Rethrow to stop consolidation in the caller
        }
    }
}

// Optional: Move the ConsolidationAnalysis interface definition here if preferred
// export interface ConsolidationAnalysis { ... }