#!/usr/bin/env node
// src/kai.ts // Note: Reverting changes from Kanban JSON migration
import * as fsSync from 'fs'; // Keep sync fs for config defaults
// REMOVED: fsPromises import
import { DEFAULT_CONFIG_YAML } from './lib/config_defaults'; // Keep config defaults import

import path from 'path';
import inquirer from 'inquirer';
import { Config } from './lib/Config';
// Ensure UserInteractionResult and any new specific result types are imported
import {
    UserInterface,
    UserInteractionResult,
    ChangeModeInteractionResult,
    ScaffoldProjectInteractionResult
} from './lib/UserInterface';
// REMOVED: KanbanData, KanbanColumn, KanbanCard imports
import { CodeProcessor } from './lib/CodeProcessor';
import { FileSystem } from './lib/FileSystem';
import { CommandService } from './lib/CommandService';
import { GitService } from './lib/GitService';
import { ProjectContextBuilder } from './lib/ProjectContextBuilder'; // <-- Ensure this is imported
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";
import { ProjectScaffolder } from './lib/ProjectScaffolder';
// *** ADDED Imports for Analysis Feature ***
import { ProjectAnalyzerService } from './lib/analysis/ProjectAnalyzerService';
import { AIClient } from './lib/AIClient'; // Needed for Analyzer instantiation
// REMOVED: uuid import
import { WebService } from './lib/WebService'; // <-- ADDED WebService import
// *** END Imports for Analysis Feature ***

// performStartupChecks adjusted signature, Config is instantiated later now
export async function performStartupChecks(
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

        // --- Ensure .kaiignore exists at project root ---
        const kaiignorePath = path.resolve(projectRoot, '.kaiignore');
        if (!fsSync.existsSync(kaiignorePath)) {
            console.log(chalk.yellow(`  '.kaiignore' not found at project root. Creating a default one...`));
            try {
                const defaultKaiignoreContent = `# Add patterns here to exclude files/directories from Kai's context (e.g., build/, *.log)\n`;
                fsSync.writeFileSync(kaiignorePath, defaultKaiignoreContent, 'utf8');
                console.log(chalk.green(`  Successfully created default .kaiignore.`));
            } catch (writeError) {
                console.error(chalk.red(`  ❌ Error creating default .kaiignore at ${kaiignorePath}:`), writeError);
            }
        }
        // --- End Scaffold config.yaml ---


        // --- Ensure .kai/logs exists (using path potentially read from config later) ---
        // Now that .kai exists, ensure logs exists within it
        const defaultLogsDir = path.resolve(configDir, "logs"); // Assume default inside .kai
        await fs.ensureKaiDirectoryExists(defaultLogsDir);

        // --- REMOVED Kanban.md / kanban.json check/migration logic ---

        console.log(chalk.green("Startup checks complete."));
        return true; // All checks passed or were successfully completed/confirmed

    } catch (error) {
        console.error(chalk.red("\n❌ Fatal Error during startup checks:"), error instanceof Error ? error.message : error);
        console.error(chalk.red("   Please resolve the issues above before running Kai again."));
        return false; // Indicate failure
    }
}

// --- REMOVED: Kanban MD to JSON Conversion/Default Logic ---
// REMOVED: convertKanbanMdToJson
// REMOVED: createDefaultKanbanJson
// --- END REMOVED Kanban Logic ---

async function main() {

    let codeProcessor: CodeProcessor | null = null;
    let ui: UserInterface | null = null; // Declare UI here
    let targetIdentifier: string | string[] | null = null;
    // interactionResult removed from here, fetched inside the loop
    let interactionResult: UserInteractionResult | null = null; // <-- DECLARED HERE
    let config: Config | undefined = undefined;
    let analyzerService: ProjectAnalyzerService | null = null; // Define analyzer service variable
    const projectRoot = process.cwd();
    let webService: WebService | null = null; // Declare webService here to be accessible in finally

    // let keepServerAlive = false; // No longer needed with the loop structure

    // --- Special Case: Handle 'show kanban' command directly ---
    const args = process.argv.slice(2); // Get arguments passed to the script
    if (args.length === 2 && args[0] === 'show' && args[1] === 'kanban') {
        // If 'show kanban', just start the server and keep the process alive.
        // Do not enter the main interactive loop.
        console.log(chalk.cyan('Starting Kanban web server (standalone mode)...'));
        // keepServerAlive = true; // Set flag (though not used as we return)
        const standaloneWebService = new WebService(projectRoot);
        try {
            await standaloneWebService.showKanban();
            // Keep Kai running so the server stays alive until Ctrl+C
            return; // Exit main function after starting server
        } catch (webError) {
            console.error(chalk.red('Error starting Kanban server in standalone mode:'), webError);
            process.exit(1); // Exit if standalone server fails
        }
    }
    // --- End Special Case Handling ---

    try {
        // --- Instantiate Core Services Needed Early (before config determination) ---
        const fs = new FileSystem();
        const commandService = new CommandService();
        const gitService = new GitService(commandService, fs);

        // --- Perform Startup Checks ---
        const placeholderUI = new UserInterface(new Config()); // Create a placeholder config
        const startupOk = await performStartupChecks(projectRoot, fs, gitService, placeholderUI);
        if (!startupOk) {
            process.exit(1);
        }

        // Instantiate Config *after* potentially creating default config.yaml
        config = new Config();
        // Instantiate UI *after* config is ready
        ui = new UserInterface(config); // <-- Assign to declared variable
        const aiClient = new AIClient(config);
        const contextBuilder = new ProjectContextBuilder(fs, gitService, projectRoot, config, aiClient);

        analyzerService = new ProjectAnalyzerService(
            config,
            fs,
            commandService,
            gitService,
            aiClient // <-- Reuse AIClient
        );

        // --- Initial Context Mode Determination Logic ---
        // (This block remains the same)
        if (config.context.mode === undefined) {
            console.log(chalk.cyan("\n🤖 Context mode not yet determined. Analyzing project size..."));
            const estimatedTokens = await contextBuilder.estimateFullContextTokens();
            const tokenLimit = (config.gemini.max_prompt_tokens || 32000) * 0.80;

            if (estimatedTokens <= tokenLimit) {
                console.log(chalk.green(`  Project size (${estimatedTokens} tokens) is within limit (${tokenLimit.toFixed(0)}). Setting mode to 'full'.`));
                config.context.mode = 'full';
            } else {
                console.warn(chalk.yellow(`  Project size (${estimatedTokens} tokens) exceeds recommended limit (${tokenLimit.toFixed(0)}). Setting mode to 'analysis_cache'.`));
                config.context.mode = 'analysis_cache';
                const cachePath = path.resolve(projectRoot, config.analysis.cache_file_path);
                const cacheExists = await fs.readAnalysisCache(cachePath) !== null;
                if (!cacheExists) {
                     console.error(chalk.red(`  Analysis cache (${config.analysis.cache_file_path}) is required but not found.`));
                     console.log(chalk.blue(`  Running project analysis now to generate the cache...`));
                     if (!analyzerService) throw new Error("Analyzer service not initialized.");
                     await analyzerService.analyzeProject();
                     if (await fs.readAnalysisCache(cachePath) === null) {
                         console.error(chalk.red(`  Analysis finished but failed to create a valid cache file at ${cachePath}. Cannot proceed.`));
                         console.error(chalk.red(`  Please check analysis logs/errors. Ensure 'phind' or 'find' works and '.gitignore' is filtering correctly.`));
                         process.exit(1);
                     }
                      console.log(chalk.green(`  Analysis complete. Proceeding in 'analysis_cache' mode.`));
                } else {
                     console.log(chalk.green(`  Found existing analysis cache at ${cachePath}. Proceeding in 'analysis_cache' mode.`));
                }
            }
             try {
                  await config.saveConfig();
             } catch (saveError) {
                  console.error(chalk.red(`  ❌ Error: Failed to save determined context mode '${config.context.mode}' to config.yaml.`), saveError);
                  console.warn(chalk.yellow(`  Warning: Proceeding with mode '${config.context.mode}' for this session only.`));
             }
        } else {
             const currentMode = config.context.mode;
             console.log(chalk.blue(`\n🔧 Context mode already set to '${currentMode}'.`));
             if ((currentMode === 'analysis_cache' || currentMode === 'dynamic')) {
                  const cachePath = path.resolve(projectRoot, config.analysis.cache_file_path);
                  const cacheExists = await fs.readAnalysisCache(cachePath) !== null;
                  if (!cacheExists) {
                       console.error(chalk.red(`  Mode is '${currentMode}', but required Analysis cache (${config.analysis.cache_file_path}) is not found.`));
                       console.log(chalk.blue(`  Running project analysis now to generate the cache...`));
                       if (!analyzerService) throw new Error("Analyzer service not initialized.");
                       await analyzerService.analyzeProject();
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
        // Instantiate WebService once for the main application life cycle
        webService = new WebService(projectRoot); // Assign to the outer variable

        // --- Start Kanban Web Service (Non-blocking) ---
        (async () => {
            try {
                console.log(chalk.dim("\nAttempting to start Kanban web server in background..."));
                await webService.showKanban(); // Reuse the webService instance
                // Server runs until Kai exits or is stopped manually
            } catch (webError) {
                // Log the error but don't block Kai's main functionality
                console.error(chalk.red('\nBackground Kanban server failed to start:'), webError);
            }
        })(); // IIAFE to run async without blocking main flow
        // --- End Kanban Web Service ---

        // --- Instantiate CodeProcessor once before the loop ---
        codeProcessor = new CodeProcessor(
            config, // Pass the final config
            fs,
            commandService,
            gitService,
            ui, // Pass the UI instance
            contextBuilder // Pass the ContextBuilder instance
        );
        // --- End CodeProcessor Instantiation ---

        // --- Main Interaction Loop ---
        while (true) {
            // Get user interaction INSIDE the loop
            interactionResult = await ui.getUserInteraction(); // <-- ASSIGN to existing variable

            if (!interactionResult) {
                break; // User chose 'Exit Kai', break the loop
            }

            const { mode } = interactionResult;

            // Reset targetIdentifier for each loop iteration
            targetIdentifier = null;

            // --- Handle selected mode ---
            if (mode === 'Start/Continue Conversation') {
                 if (!codeProcessor) throw new Error("CodeProcessor not initialized."); // Guard
                 if (!config) throw new Error("Config not initialized."); // Guard
                 const startResult = interactionResult as Extract<UserInteractionResult, { mode: 'Start/Continue Conversation' }>;
                const { conversationName: convName, isNewConversation, selectedModel } = startResult;

                targetIdentifier = convName;

                // --- Model Override Logic ---
                if (codeProcessor && selectedModel && config.gemini.model_name !== selectedModel) { // Check codeProcessor exists
                    console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                    config.gemini.model_name = selectedModel;
                    codeProcessor.updateAIClient(new AIClient(config));
                } else if (config) {
                    console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
                }
                // --- End Model Override ---

                if (!targetIdentifier) {
                    console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                    continue; // Go back to menu
                }
                // --- Call the refactored startConversation ---
                await codeProcessor.startConversation(targetIdentifier, isNewConversation ?? false);
                // --- End call ---

            } else if (mode === 'Consolidate Changes...') {
                 if (!codeProcessor) throw new Error("CodeProcessor not initialized."); // Guard
                 if (!config) throw new Error("Config not initialized."); // Guard
                 const consolidateResult = interactionResult as Extract<UserInteractionResult, { mode: 'Consolidate Changes...' }>;
                const { conversationName: convName, selectedModel } = consolidateResult;

                targetIdentifier = convName;

                // --- Model Override Logic ---
                if (selectedModel && config.gemini.model_name !== selectedModel) {
                    console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                    config.gemini.model_name = selectedModel;
                     if (codeProcessor) { codeProcessor.updateAIClient(new AIClient(config)); }
                } else if (config) {
                    console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
                }
                // --- End Model Override ---

                if (!targetIdentifier) {
                    console.error(chalk.red("Internal Error: Conversation name missing for Consolidation mode."));
                    continue; // Go back to menu
                }
                console.log(chalk.magenta(`\n🚀 Starting consolidation process for conversation: ${chalk.cyan(targetIdentifier)}...`));
                // --- Call the refactored processConsolidationRequest ---
                await codeProcessor.processConsolidationRequest(targetIdentifier);
                // --- End call ---
                console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(targetIdentifier)}.`));

            } else if (mode === 'Delete Conversation...') {
                if (!config) throw new Error("Config not initialized."); // Guard
                 const deleteResult = interactionResult as Extract<UserInteractionResult, { mode: 'Delete Conversation...' }>;
                const { conversationNamesToDelete } = deleteResult;

                targetIdentifier = conversationNamesToDelete;

                if (!targetIdentifier || !Array.isArray(targetIdentifier) || targetIdentifier.length === 0) {
                    console.error(chalk.red("Internal Error: Conversation names missing for Delete mode after confirmation."));
                    continue; // Go back to menu
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
                                console.log(chalk.gray(`    ⓘ No temporary editor file found to delete for ${nameToDelete}.`));
                            editorSkipped = true;
                        } else {
                            console.warn(chalk.yellow(`    ! Warning: Could not delete temporary editor file ${editorFilePath}:`), editorError);
                        }
                    }

                    if (conversationDeleted || editorDeleted) {
                         successCount++;
                    } else if (editorSkipped && !conversationDeleted) {
                         successCount++;
                    } else if (!conversationDeleted && !editorDeleted && !editorSkipped) {
                        successCount++;
                    }
                }

                console.log(chalk.blue(`\nDeletion Summary: ${successCount} completed (files deleted/skipped), ${failCount} failed (unexpected errors).`));
                // --- End Delete Logic ---

            } else if (mode === 'Re-run Project Analysis') {
                 if (!analyzerService) {
                      console.error(chalk.red("Internal Error: Analyzer service not initialized."));
                      continue; // Go back to menu
                 }
                 console.log(chalk.cyan("\nManually re-running project analysis..."));
                 await analyzerService.analyzeProject(); // Call analysis
                 console.log(chalk.cyan("Analysis complete."));

            } else if (mode === 'Change Context Mode') { // Needs config
                 if (!config) throw new Error("Config not initialized."); // Guard
                 const changeModeResult = interactionResult as ChangeModeInteractionResult;
                 const { newMode } = changeModeResult;
                 console.log(chalk.cyan(`\nChanging context mode to '${newMode}'...`));
                 config.context.mode = newMode; // Update in-memory config
                 await config.saveConfig(); // Persist the change
                 console.log(chalk.green(`Context mode set to '${newMode}' and saved to ${config.getConfigFilePath()}.`)); // Use public getter

            } else if (mode === 'Scaffold New Project') {
                 const scaffoldResult = interactionResult as ScaffoldProjectInteractionResult;
                 const scaffolder = new ProjectScaffolder(fs, gitService);
                 const newPath = await scaffolder.scaffoldProject(scaffoldResult);
                 process.chdir(newPath);
                 console.log(chalk.cyan(`\nSwitched to new project at ${newPath}.`));
                 const ok = await performStartupChecks(newPath, fs, gitService, ui!);
                 if (!ok) { process.exit(1); }
                 await main();
                 return;

            } else {
                console.log(chalk.yellow(`Unknown mode selected: ${mode}. Returning to menu.`));
            }
            // Loop continues here, will call ui.getUserInteraction() again
        } // End while(true) loop

    } catch (error) {
        // Error handling logic remains largely the same
        const loggableIdentifier = typeof targetIdentifier === 'string' ? targetIdentifier : Array.isArray(targetIdentifier) ? targetIdentifier.join(', ') : 'unknown_context';
         if (config && codeProcessor && codeProcessor.aiClient) {
             try {
                 // Only log to conversation file for specific modes that have a target identifier
                 if (targetIdentifier && typeof targetIdentifier === 'string' && (interactionResult?.mode === 'Start/Continue Conversation' || interactionResult?.mode === 'Consolidate Changes...')) {
                     const logFileName = `${toSnakeCase(targetIdentifier)}.jsonl`;
                     const logFilePath = path.join(config.chatsDir, logFileName);
                     await codeProcessor.aiClient.logConversation(logFilePath, { type: 'error', error: `Main execution error: ${(error as Error).message}` });
                     console.error(chalk.red(`\n🛑 Main execution error logged to: ${logFilePath}`), error);
                 } else {
                     console.error(chalk.red(`\n🛑 An unexpected error occurred in main execution (Last Mode: ${interactionResult?.mode || 'unknown'}, Context: ${loggableIdentifier}).`), error);
                 }
             } catch (logError) {
                 console.error(chalk.red("Additionally failed to log main error:"), logError);
             }
         } else {
             console.error(chalk.red(`\n🛑 General error occurred (Context: ${loggableIdentifier}). Could not log to conversation file (config or services unavailable).`), error);
         }
        process.exitCode = 1; // Indicate error on exit

    } finally {
        // Stop the web server when the main loop exits (e.g., user chose 'Exit Kai')
        // The 'show kanban' case exits before reaching here.
        if (webService) { // Check if webService was instantiated
            try {
                await webService.stopServer(); // Wait for the server to close
            } catch (stopError) {
                console.error(chalk.red('Error during server shutdown:'), stopError);
            }
        }
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();