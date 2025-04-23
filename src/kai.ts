#!/usr/bin/env node
// src/kai.ts
import * as fsSync from 'fs'; // Keep sync fs for config defaults
import { DEFAULT_CONFIG_YAML } from './lib/config_defaults'; // Keep config defaults import

import path from 'path';
import inquirer from 'inquirer';
import { Config } from './lib/Config';
// Ensure UserInteractionResult and any new specific result types are imported
import { UserInterface, UserInteractionResult, ChangeModeInteractionResult } from './lib/UserInterface';
import { CodeProcessor } from './lib/CodeProcessor';
import { FileSystem } from './lib/FileSystem';
import { CommandService } from './lib/CommandService';
import { GitService } from './lib/GitService';
import { ProjectContextBuilder } from './lib/ProjectContextBuilder'; // <-- Ensure this is imported
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";
// *** ADDED Imports for Analysis Feature ***
import { ProjectAnalyzerService } from './lib/analysis/ProjectAnalyzerService';
import { AIClient } from './lib/AIClient'; // Needed for Analyzer instantiation
// *** END Imports for Analysis Feature ***

// performStartupChecks adjusted signature, Config is instantiated later now
async function performStartupChecks(
    projectRoot: string,
    fs: FileSystem,
    gitService: GitService,
    ui: UserInterface // Already expects UI
    // REMOVED config parameter
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
                 // Ensure gitignore rules after successful init
                 await gitService.ensureGitignoreRules(projectRoot);
            }
        } else {
            console.log(chalk.green("  ✓ Git repository detected."));
            // Ensure gitignore rules even if repo exists
            await gitService.ensureGitignoreRules(projectRoot);
        }

        // --- Ensure .kai directory and Scaffold config.yaml if missing ---
        const configDir = path.resolve(projectRoot, '.kai');
        const configPath = path.resolve(configDir, 'config.yaml');
        await fs.ensureDirExists(configDir); // Ensure .kai directory exists FIRST

        if (!fsSync.existsSync(configPath)) {
            console.log(chalk.yellow(`  'config.yaml' not found in '.kai/'. Creating a default one...`));
            try {
                // Use the imported constant
                fsSync.writeFileSync(configPath, DEFAULT_CONFIG_YAML, 'utf8');
                console.log(chalk.green(`  Successfully created default config.yaml in '.kai/'.`));
            } catch (writeError) {
                console.error(chalk.red(`  ❌ Error creating default config.yaml at ${configPath}:`), writeError);
                console.warn(chalk.yellow("  Continuing startup despite config creation error..."));
            }
        } else {
            console.log(chalk.dim(`  Found existing config.yaml in '.kai/'. Skipping default creation.`));
        }
        // --- End Scaffold config.yaml ---


        // --- Ensure .kai/logs exists (using path potentially read from config later) ---
        // Now that .kai exists, ensure logs exists within it
        const defaultLogsDir = path.resolve(configDir, "logs"); // Assume default inside .kai
        await fs.ensureKaiDirectoryExists(defaultLogsDir);


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
    let ui: UserInterface | null = null; // Declare UI here
    let targetIdentifier: string | string[] | null = null;
    let interactionResult: UserInteractionResult | null = null;
    let config: Config | undefined = undefined;
    let analyzerService: ProjectAnalyzerService | null = null; // Define analyzer service variable
    const projectRoot = process.cwd();

    try {
        // --- Instantiate Core Services Needed Early (before config determination) ---
        // Instantiate services that don't strictly depend on finalized config first
        // REMOVED: ui instantiation here
        const fs = new FileSystem();
        const commandService = new CommandService();
        const gitService = new GitService(commandService, fs);
        // Cannot create ContextBuilder yet as it needs final config

        // --- Perform Startup Checks (Doesn't need config directly anymore) ---
        // We pass a placeholder UI here, which will be replaced after config loads.
        // This is a temporary measure. Ideally, startup checks needing UI would be moved
        // or the UI dependency removed from performStartupChecks.
        // For now, let's assume performStartupChecks doesn't critically need a fully configured UI *yet*.
        const placeholderUI = new UserInterface(new Config()); // Create a placeholder config
        const startupOk = await performStartupChecks(projectRoot, fs, gitService, placeholderUI);
        if (!startupOk) {
            process.exit(1);
        }


        // Instantiate Config *after* potentially creating default config.yaml
        config = new Config();
        // Provide config to instances that need it
        // Instantiate UI *after* config is ready
        ui = new UserInterface(config); // <-- Assign to declared variable
        // Instantiate AIClient once
        const aiClient = new AIClient(config);
        // Instantiate ContextBuilder now that config is ready
        // Inject AIClient into ContextBuilder
        const contextBuilder = new ProjectContextBuilder(fs, gitService, projectRoot, config, aiClient); // <-- Pass AIClient

        // --- Instantiate Analyzer Service (needed potentially) ---
        analyzerService = new ProjectAnalyzerService(
            config,
            fs,
            commandService,
            gitService,
            aiClient // <-- Reuse AIClient
        );
        // --- END Analyzer Instantiation ---


        // --- Initial Context Mode Determination Logic ---
        // Check if context mode is undefined (not set in config.yaml or invalid)
        if (config.context.mode === undefined) {
            console.log(chalk.cyan("\n🤖 Context mode not yet determined. Analyzing project size..."));
            const estimatedTokens = await contextBuilder.estimateFullContextTokens();
            // Use a threshold, e.g., 80% of max prompt tokens
            const tokenLimit = (config.gemini.max_prompt_tokens || 32000) * 0.80;

            if (estimatedTokens <= tokenLimit) {
                console.log(chalk.green(`  Project size (${estimatedTokens} tokens) is within limit (${tokenLimit.toFixed(0)}). Setting mode to 'full'.`));
                config.context.mode = 'full'; // Update in-memory config
            } else {
                console.warn(chalk.yellow(`  Project size (${estimatedTokens} tokens) exceeds recommended limit (${tokenLimit.toFixed(0)}). Setting mode to 'analysis_cache'.`));
                config.context.mode = 'analysis_cache'; // Update in-memory config

                // Check if cache exists only if mode is set to 'analysis_cache'
                const cachePath = path.resolve(projectRoot, config.analysis.cache_file_path);
                const cacheExists = await fs.readAnalysisCache(cachePath) !== null;

                if (!cacheExists) {
                     console.error(chalk.red(`  Analysis cache (${config.analysis.cache_file_path}) is required but not found.`));
                     console.log(chalk.blue(`  Running project analysis now to generate the cache...`));
                     if (!analyzerService) throw new Error("Analyzer service not initialized.");
                     await analyzerService.analyzeProject(); // Run analysis

                     // CRITICAL CHECK: Verify cache exists *after* analysis attempt
                     if (await fs.readAnalysisCache(cachePath) === null) {
                         console.error(chalk.red(`  Analysis finished but failed to create a valid cache file at ${cachePath}. Cannot proceed.`));
                         console.error(chalk.red(`  Please check analysis logs/errors. Ensure 'phind' or 'find' works and '.gitignore' is filtering correctly.`)); // Updated error hint
                         process.exit(1); // Exit if analysis failed to produce the required cache
                     }
                      console.log(chalk.green(`  Analysis complete. Proceeding in 'analysis_cache' mode.`));
                } else {
                     console.log(chalk.green(`  Found existing analysis cache at ${cachePath}. Proceeding in 'analysis_cache' mode.`));
                }
            }
            // Persist the determined mode to config.yaml
             try {
                  await config.saveConfig();
             } catch (saveError) {
                  console.error(chalk.red(`  ❌ Error: Failed to save determined context mode '${config.context.mode}' to config.yaml.`), saveError);
                  // Decide if fatal. For now, warn and continue with in-memory setting.
                  console.warn(chalk.yellow(`  Warning: Proceeding with mode '${config.context.mode}' for this session only.`));
             }
        } else {
             const currentMode = config.context.mode; // Should be 'full', 'analysis_cache', or 'dynamic'
             console.log(chalk.blue(`\n🔧 Context mode already set to '${currentMode}'.`));
             // If mode requires cache ('analysis_cache' or 'dynamic'), ensure cache exists
             if ((currentMode === 'analysis_cache' || currentMode === 'dynamic')) {
                  const cachePath = path.resolve(projectRoot, config.analysis.cache_file_path);
                  const cacheExists = await fs.readAnalysisCache(cachePath) !== null;
                  if (!cacheExists) {
                       console.error(chalk.red(`  Mode is '${currentMode}', but required Analysis cache (${config.analysis.cache_file_path}) is not found.`));
                       console.log(chalk.blue(`  Running project analysis now to generate the cache...`));
                       if (!analyzerService) throw new Error("Analyzer service not initialized.");
                       await analyzerService.analyzeProject(); // Run analysis
                       if (await fs.readAnalysisCache(cachePath) === null) {
                             console.error(chalk.red(`  Analysis finished but failed to create a valid cache file. Mode '${currentMode}' cannot function. Exiting.`));
                             process.exit(1);
                       }
                       console.log(chalk.green(`  Analysis complete. Proceeding in '${currentMode}' mode.`));
                  }
             }
        }
        // --- End Initial Context Mode Determination Logic ---

        if (!ui) throw new Error("UI was not initialized correctly."); // Type guard
        interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log(chalk.yellow("Exiting."));
            return;
        }

        const { mode } = interactionResult;

        // --- Instantiate CodeProcessor (pass UI and ContextBuilder) ---
        // Ensure CodeProcessor gets the potentially updated config
        codeProcessor = new CodeProcessor(
            config, // Pass the final config
            fs,
            commandService,
            gitService,
            ui, // Pass the UI instance
            contextBuilder // Pass the ContextBuilder instance
            // REMOVED: aiClient argument - CodeProcessor creates its own
        );
        // --- End CodeProcessor Instantiation ---

        // --- Handle selected mode ---
        if (mode === 'Start/Continue Conversation') {
             // ... (Rest of Start/Continue logic unchanged) ...
             const startResult = interactionResult as Extract<UserInteractionResult, { mode: 'Start/Continue Conversation' }>;
            const { conversationName: convName, isNewConversation, selectedModel } = startResult;

            targetIdentifier = convName;

            // --- Model Override Logic (remains the same) ---
            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
                // Recreate AIClient within CodeProcessor or update it if necessary
                // For now, assume CodeProcessor handles this internally (e.g., passes config down)
                // Or better: Pass selectedModel explicitly to startConversation if needed
                codeProcessor.aiClient = new AIClient(config); // Simple recreation for now
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }
            // --- End Model Override ---

            if (!targetIdentifier) {
                console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                throw new Error("Conversation name is required for this mode.");
            }
            // --- Call the refactored startConversation ---
            await codeProcessor.startConversation(targetIdentifier, isNewConversation ?? false);
            // --- End call ---

        } else if (mode === 'Consolidate Changes...') {
             // ... (Rest of Consolidate Changes logic unchanged) ...
             const consolidateResult = interactionResult as Extract<UserInteractionResult, { mode: 'Consolidate Changes...' }>;
            const { conversationName: convName, selectedModel } = consolidateResult;

            targetIdentifier = convName;

            // --- Model Override Logic (remains the same) ---
            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
                 // Recreate AIClient within CodeProcessor if needed
                codeProcessor.aiClient = new AIClient(config); // Simple recreation for now
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
            await codeProcessor.processConsolidationRequest(targetIdentifier);
            // --- End call ---
            console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(targetIdentifier)}.`));

        } else if (mode === 'Delete Conversation...') {
             // ... (Rest of Delete Conversation logic unchanged) ...
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
                        // Only log if conversation file *was* deleted, otherwise it's expected
                        // if (conversationDeleted) {
                            console.log(chalk.gray(`    ⓘ No temporary editor file found to delete for ${nameToDelete}.`));
                        // }
                        editorSkipped = true; // Mark as skipped regardless
                    } else {
                        console.warn(chalk.yellow(`    ! Warning: Could not delete temporary editor file ${editorFilePath}:`), editorError);
                    }
                }


                if (conversationDeleted || editorDeleted) { // Simplified condition: success if either primary file or edit file deleted
                     successCount++;
                } else if (editorSkipped && !conversationDeleted) {
                     // Consider missing conversation file + missing editor file as success (nothing to delete)
                     successCount++;
                } else if (!conversationDeleted && !editorDeleted && !editorSkipped) {
                    // Both missing, no action taken, considered success
                    successCount++;
                }
            }

            console.log(chalk.blue(`\nDeletion Summary: ${successCount} completed (files deleted/skipped), ${failCount} failed (unexpected errors).`));
            // --- End Delete Logic ---

        } else if (mode === 'Re-run Project Analysis') {
             // --- Call the Analyzer Service ---
             if (!analyzerService) {
                  console.error(chalk.red("Internal Error: Analyzer service not initialized."));
                  throw new Error("Analyzer service is required for this mode.");
             }
             console.log(chalk.cyan("\nManually re-running project analysis..."));
             await analyzerService.analyzeProject(); // Call analysis
             console.log(chalk.cyan("Analysis complete."));
             // --- End Analyzer Call ---

        } else if (mode === 'Change Context Mode') {
             // --- Update Config and Save ---
             if (!config) throw new Error("Config not initialized."); // Guard
             const changeModeResult = interactionResult as ChangeModeInteractionResult;
             const { newMode } = changeModeResult;
             console.log(chalk.cyan(`\nChanging context mode to '${newMode}'...`));
             config.context.mode = newMode; // Update in-memory config
             await config.saveConfig(); // Persist the change
             console.log(chalk.green(`Context mode set to '${newMode}' and saved to ${config.getConfigFilePath()}.`)); // Use public getter

        } else if (mode === 'Analyze Project (Update Cache)') { // Kept existing mode handling
             // --- Call the Analyzer Service ---
             if (!analyzerService) { // Should have been initialized above
                  console.error(chalk.red("Internal Error: Analyzer service not initialized."));
                  throw new Error("Analyzer service is required for this mode.");
             }
             console.log(chalk.cyan("\nManually updating analysis cache...")); // Message adjusted slightly
             await analyzerService.analyzeProject(); // Call the simple analysis
             console.log(chalk.cyan("Analysis cache update complete."));
             // --- End Analyzer Call ---

        } else {
            console.log(chalk.yellow(`Unknown mode selected: ${mode}. Exiting.`));
        }

    } catch (error) {
        const loggableIdentifier = typeof targetIdentifier === 'string' ? targetIdentifier : Array.isArray(targetIdentifier) ? targetIdentifier.join(', ') : 'unknown_context';

         // Use the instantiated codeProcessor which now contains the aiClient internally
         // Ensure config is available for logging path
         if (config && codeProcessor && codeProcessor.aiClient) {
             try {
                 // Only log to conversation file for these modes
                 if ((interactionResult?.mode === 'Start/Continue Conversation' || interactionResult?.mode === 'Consolidate Changes...') && typeof targetIdentifier === 'string') {
                     const logFileName = `${toSnakeCase(targetIdentifier)}.jsonl`;
                     const logFilePath = path.join(config.chatsDir, logFileName);
                     await codeProcessor.aiClient.logConversation(logFilePath, { type: 'error', error: `Main execution error: ${(error as Error).message}` });
                     console.error(chalk.red(`\n🛑 Main execution error logged to: ${logFilePath}`), error);
                 } else {
                     console.error(chalk.red(`\n🛑 An unexpected error occurred in main execution (Mode: ${interactionResult?.mode || 'unknown'}, Context: ${loggableIdentifier}).`), error);
                 }
             } catch (logError) {
                 console.error(chalk.red("Additionally failed to log main error:"), logError);
             }
         } else {
             console.error(chalk.red(`\n🛑 General error occurred (Context: ${loggableIdentifier}). Could not log to conversation file (config or services unavailable).`), error);
         }

        process.exitCode = 1;

    } finally {
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();