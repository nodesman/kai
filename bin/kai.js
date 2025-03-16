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
            //for now
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