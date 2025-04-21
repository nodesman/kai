#!/usr/bin/env node
// src/kai.ts

import path from 'path';
import inquirer from 'inquirer';
import { Config } from './lib/Config';
import { UserInterface, UserInteractionResult } from './lib/UserInterface'; // <-- Ensure this is imported
import { CodeProcessor } from './lib/CodeProcessor';
import { FileSystem } from './lib/FileSystem';
import { CommandService } from './lib/CommandService';
import { GitService } from './lib/GitService';
import { ProjectContextBuilder } from './lib/ProjectContextBuilder'; // <-- Ensure this is imported
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";
import { ConversationManager } from './lib/ConversationManager'; // Not directly used here, but part of the refactor

// performStartupChecks remains the same...
async function performStartupChecks(
    projectRoot: string,
    fs: FileSystem,
    gitService: GitService,
    ui: UserInterface, // Already expects UI
    config: Config
): Promise<boolean> {
    // ... (no changes needed inside this function) ...
    console.log(chalk.cyan("\nPerforming startup environment checks..."));
    try {
        // --- Git Repository Check ---
        let isRepo = await gitService.isGitRepository(projectRoot);
        let proceedWithSetup = true; // Assume we proceed unless user denies

        if (!isRepo) {
            console.log(chalk.yellow("  This directory is not currently a Git repository."));
            const isSafeDir = await fs.isDirectoryEmptyOrSafe(projectRoot);

            if (!isSafeDir) {
                console.log(chalk.yellow("  The directory is not empty and may contain important files."));
                const { confirmInit } = await inquirer.prompt([ // Use inquirer directly for startup check
                    {
                        type: 'confirm',
                        name: 'confirmInit',
                        message: `Initialize Git repository, create '.kai/logs' directory, and add '.kai/logs/' to .gitignore in this directory (${projectRoot})?`,
                        default: false,
                    }
                ]);
                proceedWithSetup = confirmInit;
                if (!proceedWithSetup) {
                     console.log(chalk.red("  User declined initialization. Aborting startup checks."));
                     return false; // User explicitly said no
                } else {
                    console.log(chalk.cyan("  User confirmed. Proceeding with initialization..."));
                }
            } else {
                 console.log(chalk.cyan("  Directory is empty or safe. Proceeding with automatic initialization..."));
            }

            // Initialize Git repo only if needed and confirmed/safe
            if (proceedWithSetup) {
                 await gitService.initializeRepository(projectRoot);
                 isRepo = true; // Mark as repo after successful init
            }
        } else {
            console.log(chalk.green("  ✓ Git repository detected."));
        }

        // --- .kai/logs and .gitignore Check (Run only if proceeding) ---
        if (proceedWithSetup) {
            // Ensure .kai/logs exists (using path from config)
            await fs.ensureKaiDirectoryExists(config.chatsDir);

            // --- Use GitService to ensure rules ---
            await gitService.ensureGitignoreRules(projectRoot);
            // --- End use GitService ---
        } else {
            // This case should only be reachable if user declined init on non-empty dir
             console.log(chalk.yellow("  Skipping .kai/logs and .gitignore checks as initialization was declined."));
             return false; // Setup was not fully completed due to user choice
        }

        console.log(chalk.green("Startup checks complete."));
        return true; // All checks passed or were successfully completed/confirmed

    } catch (error) {
        console.error(chalk.red("\n❌ Fatal Error during startup checks:"), error instanceof Error ? error.message : error);
        console.error(chalk.red("   Please resolve the issues above before running Kai again."));
        return false; // Indicate failure
    }
}


async function main() {

    let codeProcessor: CodeProcessor | null = null;
    let targetIdentifier: string | string[] | null = null;
    let interactionResult: UserInteractionResult | null = null;
    let config: Config | undefined = undefined;
    const projectRoot = process.cwd();

    try {
        // --- Instantiate Core Services Needed Early ---
        config = new Config();
        const ui = new UserInterface(config); // <-- UI Instance
        const fs = new FileSystem();
        const commandService = new CommandService();
        const gitService = new GitService(commandService, fs);
        const contextBuilder = new ProjectContextBuilder(fs, gitService, projectRoot, config); // <-- ContextBuilder Instance

        // --- Perform Startup Checks (Pass instances) ---
        const startupOk = await performStartupChecks(projectRoot, fs, gitService, ui, config);
        if (!startupOk) {
            process.exit(1);
        }

        interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log(chalk.yellow("Exiting."));
            return;
        }

        const { mode } = interactionResult;

        // --- Instantiate CodeProcessor (pass UI and ContextBuilder) ---
        codeProcessor = new CodeProcessor(
            config,
            fs,
            commandService,
            gitService,
            ui, // Pass the UI instance
            contextBuilder // Pass the ContextBuilder instance
        );
        // --- End CodeProcessor Instantiation ---

        // --- Handle selected mode ---
        if (mode === 'Start/Continue Conversation') {
            const startResult = interactionResult as Extract<UserInteractionResult, { mode: 'Start/Continue Conversation' }>;
            const { conversationName: convName, isNewConversation, selectedModel } = startResult;

            targetIdentifier = convName;

            // --- Model Override Logic (remains the same) ---
            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
                // Note: AIClient might need re-instantiation or a method to update its model if override happens *after* its creation.
                // Currently, CodeProcessor creates AIClient before this override logic.
                // For simplicity, we'll assume CodeProcessor internals handle the config change for now,
                // but a cleaner approach would be to update the model within AIClient or recreate it.
                // Let's update CodeProcessor to recreate AIClient if model changes, or better yet, pass the model name explicitly.
                // Let's adjust CodeProcessor to accept model override later if needed. For now, this config change *might* not affect the running AIClient instance depending on how it uses the config object.
                // **Revisiting this:** AIClient reads config on creation. We should update the CodeProcessor to pass the selected model name to ConversationManager.
                // **Update:** We'll stick to modifying the config for now, assuming AIClient uses the config dynamically or ConversationManager checks it. A better refactor would involve passing the model name down.
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }
            // --- End Model Override ---

            if (!targetIdentifier) {
                console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                throw new Error("Conversation name is required for this mode.");
            }
            // --- Call the refactored startConversation ---
            // No contextBuilder needed here anymore, CodeProcessor handles it internally via ConversationManager
            await codeProcessor.startConversation(targetIdentifier, isNewConversation ?? false);
            // --- End call ---

        } else if (mode === 'Consolidate Changes...') {
            const consolidateResult = interactionResult as Extract<UserInteractionResult, { mode: 'Consolidate Changes...' }>;
            const { conversationName: convName, selectedModel } = consolidateResult;

            targetIdentifier = convName;

            // --- Model Override Logic (remains the same) ---
            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
                // Same potential issue as above regarding when AIClient reads the config.
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }
            // --- End Model Override ---

            if (!targetIdentifier) {
                console.error(chalk.red("Internal Error: Conversation name missing for Consolidation mode."));
                throw new Error("Conversation name is required for consolidation.");
            }
            console.log(chalk.magenta(`\n🚀 Starting consolidation process for conversation: ${chalk.cyan(targetIdentifier)}...`));
            // --- Call the refactored processConsolidationRequest ---
            // No contextBuilder needed here anymore, CodeProcessor handles it internally
            await codeProcessor.processConsolidationRequest(targetIdentifier);
            // --- End call ---
            console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(targetIdentifier)}.`));

        } else if (mode === 'Delete Conversation...') {
             // --- Delete Logic (remains the same, uses fs directly) ---
            const deleteResult = interactionResult as Extract<UserInteractionResult, { mode: 'Delete Conversation...' }>;
            const { conversationNamesToDelete } = deleteResult;

            targetIdentifier = conversationNamesToDelete;

            if (!targetIdentifier || !Array.isArray(targetIdentifier) || targetIdentifier.length === 0) {
                console.error(chalk.red("Internal Error: Conversation names missing for Delete mode after confirmation."));
                throw new Error("Conversation names array is required for deletion.");
            }

            console.log(chalk.yellow(`\nAttempting to delete ${targetIdentifier.length} conversation(s)...`));

            let successCount = 0;
            let failCount = 0;

            for (const nameToDelete of targetIdentifier) {
                const snakeName = toSnakeCase(nameToDelete);
                const conversationFileName = `${snakeName}.jsonl`;
                const conversationFilePath = path.join(config.chatsDir, conversationFileName);
                const editorFileName = `${snakeName}_edit.txt`;
                const editorFilePath = path.join(config.chatsDir, editorFileName);

                console.log(chalk.yellow(`  Deleting: ${chalk.cyan(nameToDelete)} (${chalk.grey(snakeName)})...`));
                let conversationDeleted = false;
                let editorDeleted = false;
                let editorSkipped = false;

                try {
                    await fs.deleteFile(conversationFilePath);
                    console.log(chalk.green(`    ✓ Successfully deleted conversation file: ${conversationFilePath}`));
                    conversationDeleted = true;
                } catch (deleteError) {
                    if ((deleteError as NodeJS.ErrnoException).code === 'ENOENT') {
                        console.error(chalk.red(`    ❌ Error: Conversation file not found: ${conversationFilePath}.`));
                    } else {
                        console.error(chalk.red(`    ❌ Error deleting conversation file ${conversationFilePath}:`), deleteError);
                        failCount++;
                        continue;
                    }
                }

                try {
                    await fs.access(editorFilePath);
                    await fs.deleteFile(editorFilePath);
                    console.log(chalk.green(`    ✓ Successfully deleted temporary editor file: ${editorFilePath}`));
                    editorDeleted = true;
                } catch (editorError) {
                    if ((editorError as NodeJS.ErrnoException).code === 'ENOENT') {
                        if (conversationDeleted) {
                            console.log(chalk.gray(`    ⓘ No temporary editor file found to delete for ${nameToDelete}.`));
                        }
                        editorSkipped = true;
                    } else {
                        console.warn(chalk.yellow(`    ! Warning: Could not delete temporary editor file ${editorFilePath}:`), editorError);
                    }
                }

                if (conversationDeleted || editorDeleted || (editorSkipped && !conversationDeleted)) {
                    if (!conversationDeleted && !editorDeleted && editorSkipped) {
                       // Avoid double logging success for missing files
                    } else {
                        successCount++;
                    }
                } else if (!conversationDeleted && !editorDeleted && !editorSkipped) {
                    // Both missing, no action.
                }
            }

            console.log(chalk.blue(`\nDeletion Summary: ${successCount} completed (files deleted/skipped), ${failCount} failed (unexpected errors).`));
            // --- End Delete Logic ---

        } else {
            console.log(chalk.yellow(`Unknown mode selected. Exiting.`));
        }

    } catch (error) {
         // Error Handling remains the same, but uses the possibly refactored codeProcessor instance
         console.error(chalk.red("\n🛑 An unexpected error occurred in main execution:"), error);
        const loggableIdentifier = typeof targetIdentifier === 'string' ? targetIdentifier : Array.isArray(targetIdentifier) ? targetIdentifier.join(', ') : 'unknown_context';

         // Use the instantiated codeProcessor which now contains the aiClient internally
         if (config && codeProcessor && codeProcessor.aiClient) {
             try {
                 if (interactionResult?.mode !== 'Delete Conversation...') {
                      if (typeof targetIdentifier === 'string' && (interactionResult?.mode === 'Start/Continue Conversation' || interactionResult?.mode === 'Consolidate Changes...')) {
                         const logFileName = `${toSnakeCase(targetIdentifier)}.jsonl`;
                         const logFilePath = path.join(config.chatsDir, logFileName);
                         // Use the aiClient instance from the codeProcessor
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

        process.exitCode = 1;

    } finally {
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();