#!/usr/bin/env node
// src/kai.ts

import path from 'path';
import { Config } from './lib/Config';
import { UserInterface, UserInteractionResult } from './lib/UserInterface'; // Import updated type
import { CodeProcessor } from './lib/CodeProcessor'; // CodeProcessor needs updated constructor
import { FileSystem } from './lib/FileSystem';
// --- ADDED Imports ---
import { CommandService } from './lib/CommandService';
import { GitService } from './lib/GitService';
// --- END ADDED Imports ---
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";

/**
 * Performs essential checks when the CLI starts up.
 * Ensures .kai/logs exists, Git repo is initialized, and .gitignore is configured.
 * @param projectRoot Absolute path to the project root.
 * @param fs FileSystem instance.
 * @param gitService GitService instance.
 * @returns {Promise<boolean>} True if all checks pass, false otherwise.
 */
async function performStartupChecks(projectRoot: string, fs: FileSystem, gitService: GitService): Promise<boolean> {
    console.log(chalk.cyan("\nPerforming startup environment checks..."));
    try {
        // Check 1: .kai/logs directory (implicitly handled by Config constructor)
        console.log(chalk.dim("  Directory check (.kai/logs) handled by config loading."));
        // Check 2: Git repository status (ensure repo exists, init if necessary)
        await gitService.ensureGitRepository(projectRoot);
        // Check 3: .gitignore rules (ensure file exists, has .kai/logs/ rule)
        await fs.ensureGitignoreRules(projectRoot);
        console.log(chalk.green("Startup checks complete."));
        return true;
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
        // --- Pass config to services that need it ---
        const ui = new UserInterface(config);
        const fs = new FileSystem();
        const commandService = new CommandService();
        const gitService = new GitService(commandService);
        // --- End Core Service Instantiation ---

        // --- Perform Startup Checks ---
        const startupOk = await performStartupChecks(projectRoot, fs, gitService);
        if (!startupOk) {
            process.exit(1); // Exit if startup checks fail
        }
        // --- End Startup Checks ---

        interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log(chalk.yellow("Exiting."));
            return;
        }

        const { mode } = interactionResult; // Get mode first

        // --- Instantiate CodeProcessor (needs all services) ---
        // Pass the *same instances* of services created earlier
        codeProcessor = new CodeProcessor(config, fs, commandService, gitService); // Pass services
        // --- End CodeProcessor Instantiation ---

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
            // CodeProcessor already initialized above
            // codeProcessor = new CodeProcessor(config); // Remove redundant init
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
            // CodeProcessor already initialized above
            // codeProcessor = new CodeProcessor(config); // Remove redundant init
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
            // Use the fs instance created earlier for deletion logic

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
                    await fs.deleteFile(conversationFilePath); // Use existing fs instance
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
                    await fs.access(editorFilePath); // Use existing fs instance
                    await fs.deleteFile(editorFilePath); // Use existing fs instance
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

        // Ensure codeProcessor exists before accessing its aiClient
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