#!/usr/bin/env node
// src/kai.ts

import path from 'path';
import inquirer from 'inquirer'; // <-- Add inquirer import
import { Config } from './lib/Config';
import { UserInterface, UserInteractionResult } from './lib/UserInterface';
import { CodeProcessor } from './lib/CodeProcessor';
import { FileSystem } from './lib/FileSystem';
import { CommandService } from './lib/CommandService';
import { GitService } from './lib/GitService'; // Import GitService
import { ProjectContextBuilder } from './lib/ProjectContextBuilder'; // Import ProjectContextBuilder
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";

/**
 * Performs essential checks when the CLI starts up.
 * Handles Git repo status, .kai/logs directory, and .gitignore rules.
 * Prompts the user for confirmation if initialization is needed in a non-empty, non-Git directory.
 * @param projectRoot Absolute path to the project root.
 * @param fs FileSystem instance.
 * @param gitService GitService instance.
 * @param ui UserInterface instance for prompting.
 * @param config Config instance for paths.
 * @returns {Promise<boolean>} True if all checks pass and necessary actions are confirmed/completed, false otherwise.
 */
async function performStartupChecks(
    projectRoot: string,
    fs: FileSystem,
    gitService: GitService, // Receive GitService
    ui: UserInterface,
    config: Config
): Promise<boolean> {
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
    const projectRoot = process.cwd(); // Define project root early

    try {
        // --- Instantiate Core Services Needed Early ---
        config = new Config();
        const ui = new UserInterface(config);
        const fs = new FileSystem();
        const commandService = new CommandService();
        // --- Inject fs into GitService ---
        const gitService = new GitService(commandService, fs);
        // --- Instantiate ProjectContextBuilder with GitService ---
        const contextBuilder = new ProjectContextBuilder(fs, gitService, projectRoot, config);
        // --- End Core Service Instantiation ---

        // --- Perform Startup Checks (Pass instances) ---
        const startupOk = await performStartupChecks(projectRoot, fs, gitService, ui, config);
        if (!startupOk) {
            process.exit(1); // Exit if startup checks fail or user declines needed setup
        }
        // --- End Startup Checks ---

        interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log(chalk.yellow("Exiting."));
            return;
        }

        const { mode } = interactionResult; // Get mode first

        // --- Instantiate CodeProcessor (needs all services & contextBuilder) ---
        // Pass the *same instances* of services created earlier
        // Note: CodeProcessor now implicitly uses contextBuilder via ConsolidationService
        codeProcessor = new CodeProcessor(config, fs, commandService, gitService); // contextBuilder is no longer directly passed
        // --- End CodeProcessor Instantiation ---

        // --- Handle selected mode ---
        if (mode === 'Start/Continue Conversation') {
            const startResult = interactionResult as Extract<UserInteractionResult, { mode: 'Start/Continue Conversation' }>;
            const { conversationName: convName, isNewConversation, selectedModel } = startResult;

            targetIdentifier = convName;

            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }

            if (!targetIdentifier) {
                console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                throw new Error("Conversation name is required for this mode.");
            }
            // --- Pass contextBuilder to startConversation ---
            await codeProcessor.startConversation(targetIdentifier, isNewConversation ?? false, contextBuilder);
            // --- End pass contextBuilder ---

        } else if (mode === 'Consolidate Changes...') {
            const consolidateResult = interactionResult as Extract<UserInteractionResult, { mode: 'Consolidate Changes...' }>;
            const { conversationName: convName, selectedModel } = consolidateResult;

            targetIdentifier = convName;

            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }

            if (!targetIdentifier) {
                console.error(chalk.red("Internal Error: Conversation name missing for Consolidation mode."));
                throw new Error("Conversation name is required for consolidation.");
            }
            console.log(chalk.magenta(`\n🚀 Starting consolidation process for conversation: ${chalk.cyan(targetIdentifier)}...`));
            // --- Pass contextBuilder to processConsolidationRequest ---
            await codeProcessor.processConsolidationRequest(targetIdentifier, contextBuilder);
            // --- End pass contextBuilder ---
            console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(targetIdentifier)}.`));

        } else if (mode === 'Delete Conversation...') {
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
                // Convert user-facing name (potentially with spaces) to snake_case for file operations
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
                        // Log error but don't increment failCount if conversation file is just missing
                        console.error(chalk.red(`    ❌ Error: Conversation file not found: ${conversationFilePath}.`));
                    } else {
                        console.error(chalk.red(`    ❌ Error deleting conversation file ${conversationFilePath}:`), deleteError);
                        failCount++; // Increment failCount only for actual deletion errors
                        continue; // Skip trying to delete editor file if conversation delete failed unexpectedly
                    }
                }

                try {
                    // Always try to delete the editor file if it exists
                    await fs.access(editorFilePath); // Check existence first
                    await fs.deleteFile(editorFilePath);
                    console.log(chalk.green(`    ✓ Successfully deleted temporary editor file: ${editorFilePath}`));
                    editorDeleted = true;
                } catch (editorError) {
                    if ((editorError as NodeJS.ErrnoException).code === 'ENOENT') {
                        // It's normal for the editor file not to exist, don't log unless conversation was deleted
                        if (conversationDeleted) {
                            console.log(chalk.gray(`    ⓘ No temporary editor file found to delete for ${nameToDelete}.`));
                        }
                        editorSkipped = true;
                    } else {
                        // Log a warning for unexpected errors deleting the editor file, but don't increment failCount
                        console.warn(chalk.yellow(`    ! Warning: Could not delete temporary editor file ${editorFilePath}:`), editorError);
                    }
                }

                // Increment success if either file was actually deleted or if the editor file was expectedly skipped
                if (conversationDeleted || editorDeleted || (editorSkipped && !conversationDeleted)) { // Adjust success logic slightly
                    if (!conversationDeleted && !editorDeleted && editorSkipped) {
                         // Only log success if the only action was skipping a non-existent editor file
                         // and the conversation file was also not found (already logged as error above).
                         // This avoids double-counting success for missing files.
                    } else {
                        successCount++;
                    }
                } else if (!conversationDeleted && !editorDeleted && !editorSkipped) {
                     // If both conversation file and editor file were missing
                     // No action was taken, don't count as success or failure here
                     // The error for missing conversation file was logged earlier.
                }
            }

            console.log(chalk.blue(`\nDeletion Summary: ${successCount} completed (files deleted/skipped), ${failCount} failed (unexpected errors).`));


        } else {
            console.log(chalk.yellow(`Unknown mode selected. Exiting.`));
        }

    } catch (error) {
        console.error(chalk.red("\n🛑 An unexpected error occurred in main execution:"), error);

        const loggableIdentifier = typeof targetIdentifier === 'string' ? targetIdentifier : Array.isArray(targetIdentifier) ? targetIdentifier.join(', ') : 'unknown_context';

        if (config && codeProcessor && codeProcessor.aiClient) {
            try {
                if (interactionResult?.mode !== 'Delete Conversation...') {
                     if (typeof targetIdentifier === 'string' && (interactionResult?.mode === 'Start/Continue Conversation' || interactionResult?.mode === 'Consolidate Changes...')) {
                        const logFileName = `${toSnakeCase(targetIdentifier)}.jsonl`; // Use snake_case for logging
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

        process.exitCode = 1;

    } finally {
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();