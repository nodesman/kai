#!/usr/bin/env node
// src/kai.ts

import path from 'path';
import { Config } from './lib/Config';
import { UserInterface, UserInteractionResult } from './lib/UserInterface';
import { CodeProcessor } from './lib/CodeProcessor';
import { AIClient } from './lib/AIClient';
import { FileSystem } from './lib/FileSystem';
import chalk from 'chalk';
import { toSnakeCase } from "./lib/utils";

async function main() {
    // --- Declare variables outside the try block ---
    let codeProcessor: CodeProcessor | null = null;
    let conversationName: string | null = null;
    let interactionResult: UserInteractionResult | null = null;
    // --- MODIFICATION: Initialize config to undefined ---
    let config: Config | undefined = undefined;
    // ---

    try {
        // --- Assign config here ---
        config = new Config();
        // ---

        const ui = new UserInterface(config);
        const fs = new FileSystem();

        interactionResult = await ui.getUserInteraction();

        if (!interactionResult) {
            console.log(chalk.yellow("Exiting."));
            return;
        }

        const {
            mode,
            conversationName: convName,
            isNewConversation,
            selectedModel
        } = interactionResult;

        conversationName = convName;

        // --- Handle selected mode ---
        if (mode === 'Start/Continue Conversation') {
            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }

            if (!conversationName) {
                console.error(chalk.red("Internal Error: Conversation name missing for Start/Continue mode."));
                throw new Error("Conversation name is required for this mode.");
            }
            codeProcessor = new CodeProcessor(config);
            await codeProcessor.startConversation(conversationName, isNewConversation ?? false);

        } else if (mode === 'Consolidate Changes...') {
            if (selectedModel && config.gemini.model_name !== selectedModel) {
                console.log(chalk.blue(`Overriding default model. Using: ${chalk.cyan(selectedModel)}`));
                config.gemini.model_name = selectedModel;
            } else {
                console.log(chalk.blue(`Using AI Model: ${chalk.cyan(config.gemini.model_name)}`));
            }

            if (!conversationName) {
                console.error(chalk.red("Internal Error: Conversation name missing for Consolidation mode."));
                throw new Error("Conversation name is required for consolidation.");
            }
            console.log(chalk.magenta(`\n🚀 Starting consolidation process for conversation: ${chalk.cyan(conversationName)}...`));
            codeProcessor = new CodeProcessor(config);
            await codeProcessor.processConsolidationRequest(conversationName);
            console.log(chalk.magenta(`🏁 Consolidation process finished for ${chalk.cyan(conversationName)}.`));

        } else if (mode === 'Delete Conversation...') {
            if (!conversationName) {
                console.error(chalk.red("Internal Error: Conversation name missing for Delete mode after confirmation."));
                throw new Error("Conversation name is required for deletion.");
            }

            // config is guaranteed to be defined here if we reached this point successfully
            const conversationFileName = `${conversationName}.jsonl`;
            const conversationFilePath = path.join(config.chatsDir, conversationFileName);
            const editorFileName = `${conversationName}_edit.txt`;
            const editorFilePath = path.join(config.chatsDir, editorFileName);

            console.log(chalk.yellow(`\nAttempting to delete conversation: ${chalk.cyan(conversationName)}...`));

            try {
                await fs.deleteFile(conversationFilePath);
                console.log(chalk.green(`  ✓ Successfully deleted conversation file: ${conversationFilePath}`));

                try {
                    await fs.access(editorFilePath);
                    await fs.deleteFile(editorFilePath);
                    console.log(chalk.green(`  ✓ Successfully deleted temporary editor file: ${editorFilePath}`));
                } catch (editorError) {
                    if ((editorError as NodeJS.ErrnoException).code === 'ENOENT') {
                        console.log(chalk.gray(`  ⓘ No temporary editor file found to delete for ${conversationName}.`));
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
                throw deleteError;
            }

        } else {
            console.log(chalk.yellow(`Unknown mode selected: "${mode}". Exiting.`));
        }

    } catch (error) {
        console.error(chalk.red("\n🛑 An unexpected error occurred in main execution:"), error);

        // Now 'interactionResult' and 'config' should be accessible here
        // The 'if (config && ...)' check handles the case where config might still be undefined
        // (e.g., if new Config() itself threw an error).
        if (config && conversationName && codeProcessor && codeProcessor.aiClient) { // Check config IS defined
            try {
                if (interactionResult?.mode !== 'Delete Conversation...') {
                    const logFileName = `${toSnakeCase(conversationName)}.jsonl`;
                    // --- Access config safely here because of the 'if (config)' check above ---
                    const logFilePath = path.join(config.chatsDir, logFileName);
                    await codeProcessor.aiClient.logConversation(logFilePath, { type: 'error', error: `Main execution error: ${(error as Error).message}` });
                }
            } catch (logError) {
                console.error(chalk.red("Additionally failed to log main error:"), logError);
            }
        } else {
            console.error(chalk.red("General error occurred, potentially before config or conversation context was established."), error);
        }

        process.exitCode = 1;

    } finally {
        console.log(chalk.dim("\nKai finished execution."));
    }
}

// Execute the main function
main();