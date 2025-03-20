// File: src/lib/WebSocketServer.ts

import WebSocket from 'ws';
import {CodeProcessor} from './CodeProcessor';
import {Config} from './Config';
import {DiffFile} from './types'; // Import the DiffFile type

class WebSocketServer {
    private wss: WebSocket.Server;
    private codeProcessor: CodeProcessor;

    constructor(config: Config) {
        this.wss = new WebSocket.Server({port: 8080});
        this.codeProcessor = new CodeProcessor(config);
        this.setupConnectionHandler();
    }

    private setupConnectionHandler() {
        this.wss.on('connection', (ws: WebSocket, req) => {
            const ip = req.socket.remoteAddress;
            console.log(`Client connected from ${ip}`);

            ws.on('message', async (message: string) => { // Use async here
                console.log(`Received from ${ip}: ${message}`);

                try {
                    const json = JSON.parse(message);

                    if (json.type === 'ready') {
                        console.log("Qt Client is ready!");

                        // You might want to send a welcome message or initial state here.

                    } else if (json.type === 'chatMessage') {
                        console.log(`Chat message from ${json.messageType}: ${json.text}`);

                        if (json.messageType === "User") {
                            ws.send(JSON.stringify({
                                type: "chatMessage",
                                messageType: "User",
                                text: json.text
                            }));

                            // Get response from AI (which might include a diff)
                            const aiResponse = await this.codeProcessor.askQuestion(json.text);

                            // Send the AI response (potentially with a diff later)
                            ws.send(JSON.stringify({
                                type: "chatMessage",
                                messageType: "LLM",
                                text: aiResponse.message
                            }));

                            if (aiResponse.diffFiles) {
                                this.codeProcessor.setCurrentDiff(aiResponse.diffFiles); // Important! Store the diff
                                ws.send(JSON.stringify({type: 'diffResult', files: aiResponse.diffFiles}));
                            }
                        } else {
                            ws.send(JSON.stringify({
                                type: "chatMessage",
                                messageType: "LLM",
                                text: `You said: ${json.text}`
                            }));
                        }

                    } else if (json.type === 'applyDiff') {
                        console.log("Apply Diff requested.");
                        try {
                            await this.codeProcessor.applyDiff(); // Call the applyDiff method
                            ws.send(JSON.stringify({type: 'diffApplied'}));
                        } catch (error: any) {
                            console.error("Error applying diff:", error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'Failed to apply diff',
                                details: error.message
                            }));
                        }
                    } else if (json.type === 'requestStatus') {
                        // Handle request status (if needed)
                    } else {
                        console.log("Unknown message type:", json.type);
                        ws.send(JSON.stringify({error: 'Unknown message type', received: json}));
                    }
                } catch (error: any) {
                    console.error('Invalid JSON or other error:', error);
                    ws.send(JSON.stringify({error: 'Invalid JSON format or processing error', details: error.message}));
                }
            });

            ws.on('close', () => {
                console.log(`Client ${ip} disconnected`);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error from ${ip}:`, error);
            });
        });

        console.log('WebSocket server listening on port 8080');
    }
}

export {WebSocketServer};