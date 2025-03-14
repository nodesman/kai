#!/usr/bin/env node
// bin/coder.js

import { Config } from '../lib/Config.js';
import { UserInterface } from '../lib/UserInterface.js';
import { CodeProcessor } from '../lib/CodeProcessor.js';
import { AIClient } from '../lib/AIClient.js'; // Import AIClient

async function main() {
    try {
        const config = new Config();
        const ui = new UserInterface();
        const codeProcessor = new CodeProcessor(config);

        const interactionResult = await ui.getUserInteraction();
        if (!interactionResult) return;

        const { userPrompt, mode } = interactionResult;

        if (mode === 'Request Code Changes') {
            let processResult = await codeProcessor.processCodeChanges(userPrompt);
            while (processResult) { // Loop for retry
                const applyResult = await ui.confirmApplyChanges();
                if (applyResult) {
                    const changesStaged = await codeProcessor.applyDiffWithStaging(processResult.diffFilePath);
                    if (changesStaged) {
                        const commitResult = await ui.confirmCommitChanges();
                        if (commitResult) {
                            await codeProcessor.commitChanges(processResult.userPrompt, processResult.diffFilePath);
                            processResult = null; // Exit loop after successful commit
                        } else {
                            console.log("Changes staged but not committed.  Run `git diff --staged` to review. Run `git restore --staged .` to unstage");
                            await codeProcessor.fs.deleteFile(processResult.diffFilePath); // Await deletion
                            processResult = null; // Exit loop
                        }
                    } else {
                        // applyDiffWithStaging already handles user interaction and file deletion on failure/discard
                        console.log("Changes not applied.  See above for details.");
                        processResult = await ui.getUserInteraction(); // Get a new prompt
                    }
                } else {
                    console.log("Changes not applied.");
                    await codeProcessor.fs.deleteFile(processResult.diffFilePath); // Await deletion
                    processResult = null; // Exit loop
                }
            }
        } else if (mode === 'Ask a Question') {
            await codeProcessor.askQuestion(userPrompt);
        }
    } catch (error) {
        console.error("An error occurred:", error);
        // Use a *new* AIClient instance for logging to avoid potential issues with the main instance
        try {
            const errorLogger = new AIClient(new Config());
            await errorLogger.logConversation({ type: 'error', error: error.message }); // Await the log
        } catch (logError) {
            console.error("Error logging the error:", logError);
        }
    }
}
main();