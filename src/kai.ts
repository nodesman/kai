#!/usr/bin/env node
// bin/kai.js

import { Config } from './lib/Config';
import { UserInterface } from './lib/UserInterface';
import { CodeProcessor } from './lib/CodeProcessor';
import { AIClient } from './lib/AIClient'; // Import AIClient
import { WebSocketServer } from './lib/WebSocketServer'; // Import WebSocketServer
import FullScreenUI from "./lib/iterativeDiff/FullScreenUI"
async function main() {
    try {
        const config = new Config();
        const ui = new UserInterface();
        //const codeProcessor = new CodeProcessor(config);  // No longer needed here

        // Start the WebSocket server
        const webSocketServer = new WebSocketServer(config);


        //No longer needed here as we use the websocket server
        // const interactionResult = await ui.getUserInteraction();
        // if (!interactionResult) return;

        // const { userPrompt, mode } = interactionResult;

        // if (mode === 'Request Code Changes') {
        //     const fullScreenUI = new FullScreenUI();  // Only create ONE instance
        //     fullScreenUI.show(); // Use .show() to activate and render
        // } else if (mode === 'Ask a Question') {
        //     const response = await codeProcessor.askQuestion(userPrompt);
        //     console.log(response);
        // }
    } catch (error) {
        console.error("An error occurred:", error);
        try {
            const errorLogger: AIClient = new AIClient(new Config());
            await errorLogger.logConversation({ type: 'error', error: (error as Error).message, conversationId: "error" });
        } catch (logError) {
            console.error("Error logging the error:", logError);
        }
    }
}
main();