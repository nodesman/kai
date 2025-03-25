#!/usr/bin/env node
// bin/kai.js

import { Config } from './lib/Config';
import { UserInterface } from './lib/UserInterface';
import { CodeProcessor } from './lib/codeprocessor/CodeProcessor';
import { AIClient } from './lib/AIClient'; // Import AIClient
import { WebSocketServer } from './lib/WebSocketServer'; // Import WebSocketServer
import FullScreenUI from "./lib/iterativeDiff/FullScreenUI"
async function main() {
    try {
        const config = new Config();
        const ui = new UserInterface();
        const webSocketServer = new WebSocketServer(config);
    } catch (error) {
        console.error("An error occurred:", error);
        try {
            const errorLogger: AIClient = new AIClient(new Config());
        } catch (logError) {
            console.error("Error logging the error:", logError);
        }
    }
}
main();