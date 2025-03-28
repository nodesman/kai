#!/usr/bin/env node
// src/kai.ts

import path from 'path';
import { Config } from './lib/Config';
// --- MODIFICATION: Import the InteractionResult union type ---
import { UserInterface, InteractionResult } from './lib/UserInterface';
// --- END MODIFICATION ---
import { CodeProcessor } from './lib/CodeProcessor';
// AIClient likely not needed directly here anymore
// import { AIClient } from './lib/AIClient';
import { FileSystem } from './lib/FileSystem'; // Keep for deletion logic
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";

async function main() {
    // --- Declare variables outside the try block ---
    let codeProcessor: CodeProcessor | null = null;
    let conversationName: string | null = null;
    // --- MODIFICATION: Use the InteractionResult union type ---
    let interactionResult: InteractionResult | null = null;
    // --- END MODIFICATION ---
    let config: Config | undefined = undefined;


    try {
        config = new Config(); // Load config first
        const ui = new UserInterface(config); // Pass config to UI
        const fs = new FileSystem(); // Keep FS for deletion logic

        // --- Main Interaction Loop (Optional - uncomment 'while' and 'continue' for looping) ---
        // while (true) {

            interactionResult = await ui.getUserInteraction();

            if (!interactionResult) {
                console.log(chalk.yellow("Exiting."));
                // break; // Uncomment if looping
                return; // Exit if not looping
            }

            // --- Handle Modes Directly That Don't Need Full Conversation Context ---
            if (interactionResult.mode === 'Manage Scopes') {
                await ui.handleManageScopes(); // Call the handler
                // continue; // Uncomment if looping
                return; // Exit if not looping after managing scopes
            }

            if (interactionResult.mode === 'Suggest Scopes') {
                await ui.handleSuggestScopes(); // Call the handler
                // continue; // Uncomment if looping
                return; // Exit if not looping after suggesting scopes
            }
            // --- END Direct Mode Handling ---


            // --- Modes requiring conversation details ---
            // Type assertion is now safe because Manage/Suggest/Exit are handled above
            // The type of specificResult will be UserInteractionResult
            const specificResult = interactionResult; // No need for assertion if types are correct
            const {
                mode,
                conversationName: convName,
                isNewConversation,
                selectedModel
            } = specificResult;

            conversationName = convName; // Assign conversation name

            // Ensure conversation name exists for modes that require it
            if (!conversationName && (mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...' || mode === 'Delete Conversation...')) {
                 console.error(chalk.red(`Internal Error: Conversation name missing for mode "${mode}" after selection.`));
                 throw new Error(`Conversation name is required for mode "${mode}".`);
            }


            // --- Handle selected mode ---
            if (mode === 'Start/Continue Conversation') {
                // Model selection logging and config override (unchanged)
                if (selectedModel && config.gemini.model_name !== selectedModel) {
                     console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                     config.gemini.model_name = selectedModel;
                } else {
                     console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name || 'Unknown')}`));
                }

                // conversationName is guaranteed non-null here by the check above
                codeProcessor = new CodeProcessor(config);
                await codeProcessor.startConversation(conversationName!, isNewConversation ?? false); // Use null assertion safely

            } else if (mode === 'Consolidate Changes...') {
                 // Model selection logging and config override (unchanged)
                 if (selectedModel && config.gemini.model_name !== selectedModel) {
                    console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                    config.gemini.model_name = selectedModel;
                } else {
                    console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name || 'Unknown')}`));
                }

                 // conversationName is guaranteed non-null here
                console.log(chalk.magenta(`\n🚀 Starting consolidation process for conversation: ${chalk.cyan(conversationName!)}...`));
                codeProcessor = new CodeProcessor(config);
                await codeProcessor.processConsolidationRequest(conversationName!);
                console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(conversationName!)}.`));

            } else if (mode === 'Delete Conversation...') {
                // conversationName is guaranteed non-null here
                // config is guaranteed to be defined here if we reached this point successfully
                const conversationFileName = `${toSnakeCase(conversationName!)}.jsonl`; // Use snake_case name
                const conversationFilePath = path.join(config.chatsDir, conversationFileName);
                const editorFileName = `${toSnakeCase(conversationName!)}_edit.txt`; // Use snake_case name
                const editorFilePath = path.join(config.chatsDir, editorFileName);

                console.log(chalk.yellow(`\nAttempting to delete conversation: ${chalk.cyan(conversationName!)}...`));

                try {
                    await fs.deleteFile(conversationFilePath);
                    console.log(chalk.green(`  ✓ Successfully deleted conversation file: ${conversationFilePath}`));

                    try {
                        await fs.access(editorFilePath); // Check if editor file exists before deleting
                        await fs.deleteFile(editorFilePath);
                        console.log(chalk.green(`  ✓ Successfully deleted temporary editor file: ${editorFilePath}`));
                    } catch (editorError) {
                        if ((editorError as NodeJS.ErrnoException).code === 'ENOENT') {
                            console.log(chalk.gray(`  ⓘ No temporary editor file found to delete for ${conversationName!}.`));
                        } else {
                            console.warn(chalk.yellow(`  ! Warning: Could not delete temporary editor file ${editorFilePath}:`), editorError);
                        }
                    }

                } catch (deleteError) {
                    if ((deleteError as NodeJS.ErrnoException).code === 'ENOENT') {
                        console.error(chalk.red(`\n❌ Error: Conversation file not found: ${conversationFilePath}. It might have already been deleted.`));
                    } else {
                        console.error(chalk.red(`\n❌ Error deleting conversation file ${conversationFilePath}:`), deleteError);
                    }
                    // Decide if you want to throw or just log the error and continue/exit
                    // throw deleteError; // Re-throwing might stop the application flow
                }

            } else {
                // This case should ideally not be reached if all modes are handled
                 console.log(chalk.yellow(`Unknown mode reached main handler: "${mode}". Exiting.`));
            }

            // break; // Uncomment if looping

    } catch (error) {
        console.error(chalk.red("\n🛑 An unexpected error occurred in main execution:"), error);

        // --- Keep simplified error logging as specific errors are handled/logged closer to source ---
        // Avoid complex logging here that relies on potentially unavailable state (like conversationName or codeProcessor)
        // The specific handlers (startConversation, processConsolidationRequest, etc.) should log their own errors.

        process.exitCode = 1; // Indicate failure

    } finally {
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();