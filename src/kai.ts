#!/usr/bin/env node
// src/kai.ts

import path from 'path';
import { Config } from './lib/Config';
import { UserInterface } from './lib/UserInterface';
import { CodeProcessor } from './lib/CodeProcessor';
import { AIClient } from './lib/AIClient'; // Keep for potential error logging
import FullScreenUI from "./lib/iterativeDiff/FullScreenUI"; // Keep for TUI mode
import chalk from 'chalk';
import {toSnakeCase} from "./lib/utils"; // For logging

// Import utility if needed for logging path
// import { toSnakeCase } from './lib/utils';

async function main() {
    let codeProcessor: CodeProcessor | null = null; // Define outside try block
    let conversationName: string | null = null;
    // editorFilePath is managed within startConversation, no need to track here for consolidation
    // let editorFilePath: string | null = null;

    try {
        const config = new Config(); // Load initial config (with defaults)
        const ui = new UserInterface(config); // Pass initial config to UI

        // Get mode, conversation details, AND selected model
        // UserInterface should now return these based on its prompts
        const interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log(chalk.yellow("Exiting. User cancelled initial prompts."));
            return; // Exit if user cancels initial prompts
        }

        // Destructure results including the selected model
        const {
            mode,
            conversationName: convName, // Will be defined for Conversation and Consolidation modes
            isNewConversation, // Relevant only for Conversation mode
            selectedModel // Get the chosen model name
        } = interactionResult;

        conversationName = convName; // Store for potential logging, ensure it's available

        // --- Override Config with Selected Model ---
        // Check if the selected model is different from the default/initial one
        if (selectedModel && config.gemini.model_name !== selectedModel) {
            console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
            config.gemini.model_name = selectedModel;
        } else {
            // Inform the user which model is being used (either default or explicitly selected same as default)
            console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
        }
        // --- End Config Override ---

        // Now instantiate CodeProcessor with the potentially updated config
        codeProcessor = new CodeProcessor(config);

        // --- Handle selected mode ---
        if (mode === 'Start/Continue Conversation') {
            if (!conversationName) { // Should always have a name here, but check defensively
                console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                throw new Error("Conversation name is required for this mode.");
            }
            // The codeProcessor now has the config with the correct model name
            await codeProcessor.startConversation(conversationName, isNewConversation ?? false); // Pass isNewConversation

        } else if (mode === 'Request Code Changes (TUI - Experimental)') {
            // The codeProcessor now has the config with the correct model name
            await codeProcessor.startCodeChangeTUI();
            console.log(chalk.green("TUI Mode started (Press q or Ctrl+C in TUI to exit)."));
            // Note: startCodeChangeTUI might need to return or handle its own exit loop

        } else if (mode === 'Consolidate Changes...') { // <-- New Consolidation Mode Handler
            if (!conversationName) { // Should always have a name here
                console.error(chalk.red("Internal Error: Conversation name missing for Consolidation mode."));
                throw new Error("Conversation name is required for consolidation.");
            }
            console.log(chalk.magenta(`\n🚀 Starting consolidation process for conversation: ${chalk.cyan(conversationName)}...`));
            // The codeProcessor now has the config with the correct model name
            await codeProcessor.processConsolidationRequest(conversationName);
            console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(conversationName)}.`));

        } else {
            console.log(chalk.yellow(`Unknown mode selected: "${mode}". Exiting.`));
        }

    } catch (error) {
        // Centralized error handling
        console.error(chalk.red("\n🛑 An unexpected error occurred in main execution:"), error);

        // Optional: Log error to a central log file or specific conversation if identifiable
        if (conversationName && codeProcessor) {
            try {
                const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
                const conversationFilePath = path.join(codeProcessor.config.chatsDir, conversationFileName);
                await codeProcessor.aiClient.logConversation(conversationFilePath, { type: 'error', error: `Main execution error: ${(error as Error).message}` });
            } catch (logError) {
                console.error(chalk.red("Additionally failed to log main error to conversation file:"), logError);
            }
        } else {
            // Log general error if conversation context isn't available
            // Could use a general 'kai_error.log' file here
        }

        process.exitCode = 1; // Indicate failure

    } finally {
        // --- Final Cleanup ---
        // No editorFilePath cleanup needed here as it's handled within startConversation
        // If other global resources were opened, clean them up here.
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();