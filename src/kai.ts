#!/usr/bin/env node
// bin/kai.ts

import { Config } from './lib/Config';
import { UserInterface } from './lib/UserInterface';
import { CodeProcessor } from './lib/CodeProcessor';
import { AIClient } from './lib/AIClient'; // Keep for error logging if needed elsewhere
import FullScreenUI from "./lib/iterativeDiff/FullScreenUI"; // Keep for TUI mode

async function main() {
    let codeProcessor: CodeProcessor | null = null; // Define outside try block for access in finally
    let conversationName: string | null = null;
    let editorFilePath: string | null = null; // Track for final cleanup

    try {
        const config = new Config();
        const ui = new UserInterface(config); // Pass config
        codeProcessor = new CodeProcessor(config); // Pass config

        // Get mode and conversation details first
        const interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log("Exiting.");
            return; // Exit if user cancels initial prompts
        }

        const { mode, conversationName: convName, isNewConversation } = interactionResult;
        conversationName = convName; // Store for potential cleanup

        if (mode === 'Start/Continue Conversation') {
            // Start the conversation loop managed by CodeProcessor
            await codeProcessor.startConversation(conversationName, isNewConversation);

        } else if (mode === 'Request Code Changes (TUI - Experimental)') {
            // Handle the TUI mode separately
            await codeProcessor.startCodeChangeTUI();
            // The TUI promise might keep the process alive, or we need other logic here
            console.log("TUI Mode started (Press q or Ctrl+C in TUI to exit).");


        } else {
            console.log("Unknown mode selected. Exiting.");
        }

    } catch (error) {
        console.error("\n🛑 An unexpected error occurred in main:", error);
        // Centralized error logging (optional, AIClient handles its errors)
        // try {
        //     const errorLogger = new AIClient(new Config()); // Needs config
        //     const logPath = conversationName
        //         ? path.join(new Config().chatsDir, `${toSnakeCase(conversationName)}.jsonl`)
        //         : path.join(new Config().chatsDir, `general_error_log.jsonl`);
        //     await errorLogger.logConversation(logPath, { type: 'error', error: `Main loop error: ${(error as Error).message}` });
        // } catch (logError) {
        //     console.error("🚨 Error logging the main error:", logError);
        // }
        process.exitCode = 1; // Indicate failure

    } finally {
        // Ensure editor file is cleaned up even if errors occur,
        // but only if CodeProcessor didn't handle it already (e.g., startConversation loop completion)
        // This might be redundant if startConversation's finally block always runs.
        if (editorFilePath && codeProcessor) {
            try {
                // Check if file still exists before attempting deletion
                await codeProcessor.fs.access(editorFilePath);
                await codeProcessor.fs.deleteFile(editorFilePath);
                console.log(`Final cleanup ensured for editor file: ${editorFilePath}`);
            } catch (finalCleanupError) {
                // Ignore ENOENT (file already deleted), log others
                if ((finalCleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.warn(`\nWarning: Final cleanup failed for editor file ${editorFilePath}:`, finalCleanupError);
                }
            }
        }
        console.log("\nKai finished.");
    }
}

main();