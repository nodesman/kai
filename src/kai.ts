#!/usr/bin/env node
// src/kai.ts

import path from 'path';
import { Config } from './lib/Config';
import { UserInterface, UserInteractionResult } from './lib/UserInterface'; // Import updated type
import { CodeProcessor } from './lib/CodeProcessor';
// AIClient import is not directly used here, CodeProcessor handles it
// import { AIClient } from './lib/AIClient';
import { FileSystem } from './lib/FileSystem';
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";

async function main() {
    // --- Declare variables outside the try block ---
    let codeProcessor: CodeProcessor | null = null;
    // --- MODIFICATION: Use a generic name holder, specific logic below ---
    let targetIdentifier: string | string[] | null = null;
    // ---
    let interactionResult: UserInteractionResult | null = null;
    let config: Config | undefined = undefined;

    try {
        config = new Config();
        const ui = new UserInterface(config);
        const fs = new FileSystem(); // Keep fs instance

        interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log(chalk.yellow("Exiting."));
            return;
        }

        const { mode } = interactionResult; // Get mode first

        // --- Handle selected mode ---
        if (mode === 'Start/Continue Conversation') {
            // Type assertion because we know the mode
            const startResult = interactionResult as Extract<UserInteractionResult, { mode: 'Start/Continue Conversation' }>;
            const { conversationName: convName, isNewConversation, selectedModel } = startResult;

            targetIdentifier = convName; // Store the single name

            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }

            if (!targetIdentifier) { // Check the stored identifier
                console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                throw new Error("Conversation name is required for this mode.");
            }
            codeProcessor = new CodeProcessor(config);
            await codeProcessor.startConversation(targetIdentifier, isNewConversation ?? false);

        } else if (mode === 'Consolidate Changes...') {
            // Type assertion
            const consolidateResult = interactionResult as Extract<UserInteractionResult, { mode: 'Consolidate Changes...' }>;
            const { conversationName: convName, selectedModel } = consolidateResult;

            targetIdentifier = convName; // Store the single name

            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }

            if (!targetIdentifier) { // Check the stored identifier
                console.error(chalk.red("Internal Error: Conversation name missing for Consolidation mode."));
                throw new Error("Conversation name is required for consolidation.");
            }
            console.log(chalk.magenta(`\n🚀 Starting consolidation process for conversation: ${chalk.cyan(targetIdentifier)}...`));
            codeProcessor = new CodeProcessor(config);
            await codeProcessor.processConsolidationRequest(targetIdentifier);
            console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(targetIdentifier)}.`));

        } else if (mode === 'Delete Conversation...') {
            // --- MODIFICATION: Handle multiple deletions ---
            // Type assertion
            const deleteResult = interactionResult as Extract<UserInteractionResult, { mode: 'Delete Conversation...' }>;
            const { conversationNamesToDelete } = deleteResult;

            targetIdentifier = conversationNamesToDelete; // Store the array

            if (!targetIdentifier || !Array.isArray(targetIdentifier) || targetIdentifier.length === 0) {
                console.error(chalk.red("Internal Error: Conversation names missing for Delete mode after confirmation."));
                throw new Error("Conversation names array is required for deletion.");
            }

            console.log(chalk.yellow(`\nAttempting to delete ${targetIdentifier.length} conversation(s)...`));

            let successCount = 0;
            let failCount = 0;

            for (const nameToDelete of targetIdentifier) {
                // Names are already snake-cased base names from listJsonlFiles
                const conversationFileName = `${nameToDelete}.jsonl`;
                const conversationFilePath = path.join(config.chatsDir, conversationFileName);
                const editorFileName = `${nameToDelete}_edit.txt`;
                const editorFilePath = path.join(config.chatsDir, editorFileName);

                console.log(chalk.yellow(`  Deleting: ${chalk.cyan(nameToDelete)}...`));
                let conversationDeleted = false;
                let editorDeleted = false;
                let editorSkipped = false;

                // Try deleting conversation file
                try {
                    await fs.deleteFile(conversationFilePath);
                    console.log(chalk.green(`    ✓ Successfully deleted conversation file: ${conversationFilePath}`));
                    conversationDeleted = true;
                } catch (deleteError) {
                    if ((deleteError as NodeJS.ErrnoException).code === 'ENOENT') {
                        console.error(chalk.red(`    ❌ Error: Conversation file not found: ${conversationFilePath}.`));
                        // Continue to try deleting editor file even if main file not found
                    } else {
                        console.error(chalk.red(`    ❌ Error deleting conversation file ${conversationFilePath}:`), deleteError);
                        failCount++;
                        continue; // Skip to next conversation on critical error deleting main file
                    }
                }

                // Try deleting editor file (only if main file existed or deletion didn't error critically)
                try {
                    await fs.access(editorFilePath); // Check if editor file exists
                    await fs.deleteFile(editorFilePath);
                    console.log(chalk.green(`    ✓ Successfully deleted temporary editor file: ${editorFilePath}`));
                    editorDeleted = true;
                } catch (editorError) {
                    if ((editorError as NodeJS.ErrnoException).code === 'ENOENT') {
                        // Only log if the conversation file was actually found/deleted
                        if (conversationDeleted) {
                            console.log(chalk.gray(`    ⓘ No temporary editor file found to delete for ${nameToDelete}.`));
                        }
                        editorSkipped = true; // Mark as skipped even if conversation file wasn't there
                    } else {
                        console.warn(chalk.yellow(`    ! Warning: Could not delete temporary editor file ${editorFilePath}:`), editorError);
                        // Don't increment failCount here unless you deem editor file deletion critical
                    }
                }

                if (conversationDeleted || editorDeleted || editorSkipped) {
                    successCount++; // Count as success if either file was deleted or editor was skipped correctly
                }
            } // End loop

            console.log(chalk.blue(`\nDeletion Summary: ${successCount} succeeded, ${failCount} failed.`));
            // --- END MODIFICATION ---

        } else {
            // Should be unreachable due to type checking, but good defensive programming
            console.log(chalk.yellow(`Unknown mode selected. Exiting.`));
        }

    } catch (error) {
        console.error(chalk.red("\n🛑 An unexpected error occurred in main execution:"), error);

        // --- Error logging - Attempt to log based on available info ---
        // Check if config and aiClient were initialized (needed for logging)
        // The targetIdentifier might be a string or an array depending on where the error occurred
        const loggableIdentifier = typeof targetIdentifier === 'string' ? targetIdentifier : Array.isArray(targetIdentifier) ? targetIdentifier.join(', ') : 'unknown_context';

        if (config && codeProcessor && codeProcessor.aiClient) { // Check crucial components exist
            try {
                // Don't log errors during the delete process itself to the (now deleted) file
                if (interactionResult?.mode !== 'Delete Conversation...') {
                     // Use the single name if available and applicable mode
                     if (typeof targetIdentifier === 'string' && (interactionResult?.mode === 'Start/Continue Conversation' || interactionResult?.mode === 'Consolidate Changes...')) {
                        const logFileName = `${toSnakeCase(targetIdentifier)}.jsonl`;
                        const logFilePath = path.join(config.chatsDir, logFileName);
                        await codeProcessor.aiClient.logConversation(logFilePath, { type: 'error', error: `Main execution error: ${(error as Error).message}` });
                     } else {
                         console.warn(chalk.yellow("Could not determine specific conversation file to log error to."));
                     }
                }
            } catch (logError) {
                console.error(chalk.red("Additionally failed to log main error:"), logError);
            }
        } else {
             console.error(chalk.red(`General error occurred (Context: ${loggableIdentifier}). Could not log to conversation file (config or AI client unavailable).`), error);
        }
        // --- End Error Logging ---

        process.exitCode = 1;

    } finally {
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();