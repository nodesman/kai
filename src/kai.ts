#!/usr/bin/env node
// bin/kai.ts

import path from 'path'; // Import path for logging if re-enabled
import { Config } from './lib/Config';
import { UserInterface } from './lib/UserInterface';
import { CodeProcessor } from './lib/CodeProcessor';
import { AIClient } from './lib/AIClient'; // Keep for potential error logging
import FullScreenUI from "./lib/iterativeDiff/FullScreenUI"; // Keep for TUI mode
// Import utility if needed for logging path (though commented out)
// import { toSnakeCase } from './lib/utils';

async function main() {
    let codeProcessor: CodeProcessor | null = null; // Define outside try block
    let conversationName: string | null = null;
    let editorFilePath: string | null = null; // Track for final cleanup

    try {
        const config = new Config(); // Load initial config (with defaults)
        const ui = new UserInterface(config); // Pass initial config to UI for default selection

        // Get mode, conversation details, AND selected model
        const interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log("Exiting.");
            return; // Exit if user cancels initial prompts
        }

        // Destructure results including the selected model
        const {
            mode,
            conversationName: convName,
            isNewConversation,
            selectedModel // Get the chosen model name
        } = interactionResult;

        // --- Override Config with Selected Model ---
        // Check if the selected model is different from the default/initial one
        if (selectedModel && config.gemini.model_name !== selectedModel) {
            console.log(`Overriding default model. Using: ${selectedModel}`);
            config.gemini.model_name = selectedModel;
        } else {
            // Inform the user which model is being used (either default or explicitly selected same as default)
            console.log(`Using AI Model: ${config.gemini.model_name}`);
        }
        // --- End Config Override ---


        // Now instantiate CodeProcessor with the potentially updated config
        codeProcessor = new CodeProcessor(config);
        conversationName = convName; // Store for potential cleanup/logging


        // --- Handle selected mode ---
        if (mode === 'Start/Continue Conversation') {
            // The codeProcessor now has the config with the correct model name
            await codeProcessor.startConversation(conversationName, isNewConversation);

        } else if (mode === 'Request Code Changes (TUI - Experimental)') {
            // The codeProcessor now has the config with the correct model name
            await codeProcessor.startCodeChangeTUI();
            console.log("TUI Mode started (Press q or Ctrl+C in TUI to exit).");

        } else {
            console.log("Unknown mode selected. Exiting.");
        }

    } catch (error) {
        console.error("\n🛑 An unexpected error occurred in main:", error);
        // Optional: Centralized error logging
        // ... (logging code remains the same, might use conversationName) ...
        process.exitCode = 1; // Indicate failure

    } finally {
        // Cleanup logic remains the same
        if (editorFilePath && codeProcessor) {
            try {
                await codeProcessor.fs.access(editorFilePath);
                await codeProcessor.fs.deleteFile(editorFilePath);
                // console.log(`Final cleanup ensured for editor file: ${editorFilePath}`); // Optional logging
            } catch (finalCleanupError) {
                if ((finalCleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.warn(`\nWarning: Final cleanup failed for editor file ${editorFilePath}:`, finalCleanupError);
                }
            }
        }
        console.log("\nKai finished.");
    }
}

main();