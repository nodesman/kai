#!/usr/bin/env node
// src/kai.ts

import path from 'path';
import { Config } from './lib/Config';
import { UserInterface, InteractionResult } from './lib/UserInterface'; // Still needed for main interaction flow
import { CodeProcessor } from './lib/CodeProcessor';
import { FileSystem } from './lib/FileSystem';
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";
// --- ADDED: Import ScopeUIManager ---
import { ScopeUIManager } from './lib/ui/ScopeUIManager';
// --- END ADDED ---
// --- ADDED: Import ScopeManager (needed for ScopeUIManager) ---
import { ScopeManager } from './lib/ScopeManager';
// --- END ADDED ---


async function main() {
    // --- Declare variables outside the try block ---
    let codeProcessor: CodeProcessor | null = null;
    let conversationName: string | null = null;
    let interactionResult: InteractionResult | null = null;
    let config: Config | undefined = undefined;
    // --- ADDED: ScopeUIManager instance ---
    let scopeUIManager: ScopeUIManager | undefined = undefined;
    // --- END ADDED ---


    try {
        config = new Config(); // Load config first
        const fs = new FileSystem(); // Keep FS for deletion logic and ScopeUIManager
        const ui = new UserInterface(config); // Pass config to UI

        // --- ADDED: Instantiate ScopeUIManager ---
        // It needs ScopeManager, Config, FileSystem, projectRoot
        const scopeManager = new ScopeManager(config, fs); // Instantiate ScopeManager needed by ScopeUIManager
        scopeUIManager = new ScopeUIManager(scopeManager, config, fs, process.cwd());
        // --- END ADDED ---


        // --- Main Interaction Loop (Optional - uncomment 'while' and 'continue' for looping) ---
        // while (true) {

            interactionResult = await ui.getUserInteraction(); // This method remains in UserInterface

            if (!interactionResult) {
                console.log(chalk.yellow("Exiting."));
                // break; // Uncomment if looping
                return; // Exit if not looping
            }

            // --- Handle Modes Directly That Don't Need Full Conversation Context ---
            if (interactionResult.mode === 'Manage Scopes') {
                // --- MODIFIED: Delegate to ScopeUIManager ---
                if (!scopeUIManager) throw new Error("ScopeUIManager not initialized."); // Should not happen
                await scopeUIManager.runManageScopes(); // Call the ScopeUIManager method
                // --- END MODIFICATION ---
                // continue; // Uncomment if looping
                return; // Exit if not looping after managing scopes
            }

            if (interactionResult.mode === 'Suggest Scopes') {
                 // --- MODIFIED: Delegate to ScopeUIManager ---
                if (!scopeUIManager) throw new Error("ScopeUIManager not initialized."); // Should not happen
                await scopeUIManager.runSuggestScopes(); // Call the ScopeUIManager method
                // --- END MODIFICATION ---
                // continue; // Uncomment if looping
                return; // Exit if not looping after suggesting scopes
            }
            // --- END Direct Mode Handling ---


            // --- Modes requiring conversation details ---
            // Type assertion is now safe because Manage/Suggest/Exit are handled above
            const specificResult = interactionResult;
            const {
                mode,
                conversationName: convName,
                isNewConversation,
                selectedModel
            } = specificResult;

            conversationName = convName;

            if (!conversationName && (mode === 'Start/Continue Conversation' || mode === 'Consolidate Changes...' || mode === 'Delete Conversation...')) {
                 console.error(chalk.red(`Internal Error: Conversation name missing for mode "${mode}" after selection.`));
                 throw new Error(`Conversation name is required for mode "${mode}".`);
            }

            // --- Handle selected mode ---
            if (mode === 'Start/Continue Conversation') {
                if (selectedModel && config.gemini.model_name !== selectedModel) {
                     console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                     config.gemini.model_name = selectedModel;
                } else {
                     console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name || 'Unknown')}`));
                }

                codeProcessor = new CodeProcessor(config); // CodeProcessor now uses SublimeEditorInteraction internally
                await codeProcessor.startConversation(conversationName!, isNewConversation ?? false);

            } else if (mode === 'Consolidate Changes...') {
                 if (selectedModel && config.gemini.model_name !== selectedModel) {
                    console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                    config.gemini.model_name = selectedModel;
                } else {
                    console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name || 'Unknown')}`));
                }

                console.log(chalk.magenta(`\n🚀 Starting consolidation process for conversation: ${chalk.cyan(conversationName!)}...`));
                codeProcessor = new CodeProcessor(config);
                await codeProcessor.processConsolidationRequest(conversationName!);
                console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(conversationName!)}.`));

            } else if (mode === 'Delete Conversation...') {
                const conversationFileName = `${toSnakeCase(conversationName!)}.jsonl`;
                const conversationFilePath = path.join(config.chatsDir, conversationFileName);
                const editorFileName = `${toSnakeCase(conversationName!)}_edit.txt`;
                const editorFilePath = path.join(config.chatsDir, editorFileName);

                console.log(chalk.yellow(`\nAttempting to delete conversation: ${chalk.cyan(conversationName!)}...`));

                try {
                    await fs.deleteFile(conversationFilePath);
                    console.log(chalk.green(`  ✓ Successfully deleted conversation file: ${conversationFilePath}`));

                    try {
                        await fs.access(editorFilePath);
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
                }

            } else {
                 console.log(chalk.yellow(`Unknown mode reached main handler: "${mode}". Exiting.`));
            }

            // break; // Uncomment if looping

    } catch (error) {
        console.error(chalk.red("\n🛑 An unexpected error occurred in main execution:"), error);
        process.exitCode = 1; // Indicate failure

    } finally {
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();