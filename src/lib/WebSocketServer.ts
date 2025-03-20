// File: src/lib/WebSocketServer.ts

import WebSocket from 'ws';
import {CodeProcessor} from './CodeProcessor';
import {Config} from './Config';
import {DiffFile} from './types'; // Import the DiffFile type

interface ChatMessage {
    type: string;
    messageType: string;
    text: string;
    conversationId?: string; // Add optional conversationId
}

interface DiffResult {
    type: string;
    files: DiffFile[];
    conversationId?: string; // Add optional conversationId
}

interface ExplanationMessage {
    type: string;
    explanation: string;
    conversationId?: string; // Add optional conversationId
}
interface DiffCheckResult {
    type: string;
    hasDiff: boolean;
    conversationId?: string; // Add optional conversationId
}
interface CommentCheckResult {
    type: string;
    hasComments: boolean;
    conversationId?: string; // Add optional conversationId
}

interface ErrorMessage {
    type: string;
    message: string;
    details: string;
    conversationId?: string; // Add optional conversationId
}
type WebSocketMessage = ChatMessage | DiffResult | ExplanationMessage | ErrorMessage | {type: string} // Add other message types as needed

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
                let json: ChatMessage;
                try {
                    json = JSON.parse(message); // Ensure message is ChatMessage
                    const conversationId = json.conversationId; // Extract conversation ID

                    if (json.type === 'ready') {
                        console.log("Qt Client is ready!");

                        // You might want to send a welcome message or initial state here.

                    } else if (json.type === 'chatMessage') {
                        console.log(`Chat message from ${json.messageType}: ${json.text}`);

                        if (json.messageType === "User") {
                            ws.send(JSON.stringify({
                                type: "chatMessage",
                                messageType: "User",
                                text: json.text,
                                conversationId: conversationId // Send back the conversationId
                            }));

                            // Get response from AI (which might include a diff)
                            const aiResponse = await this.codeProcessor.askQuestion(json.text, conversationId);

                            // Send the AI response (potentially with a diff later)
                            const chatMessage: ChatMessage = {
                                type: "chatMessage",
                                messageType: "LLM",
                                text: aiResponse.message,
                                conversationId: conversationId // Propagate conversationId
                            };
                            ws.send(JSON.stringify(chatMessage));
                            const commentCheckPrompt = `Does the following text contain comments? Respond with "true" or "false".\n\n${aiResponse.message}`;
                            const commentCheckResponse = await this.codeProcessor.checkResponse(commentCheckPrompt);
                            const hasComments = commentCheckResponse.toLowerCase().includes("true");
                            const commentCheckResult: CommentCheckResult = {
                                type: "commentCheckResult",
                                hasComments: hasComments,
                                conversationId: conversationId
                            };
                            ws.send(JSON.stringify(commentCheckResult));

                            if (aiResponse.explanation) {
                                const explanationMessage: ExplanationMessage = {
                                    type: "explanation",
                                    explanation: aiResponse.explanation,
                                    conversationId: conversationId
                                };
                                ws.send(JSON.stringify(explanationMessage));
                            }

                            if (aiResponse.diffFiles) {
                                this.codeProcessor.setCurrentDiff(aiResponse.diffFiles); // Important! Store the diff
                                const diffResult: DiffResult = {
                                    type: 'diffResult',
                                    files: aiResponse.diffFiles,
                                    conversationId: conversationId
                                };
                                ws.send(JSON.stringify(diffResult));
                            }
                        } else {
                            const chatMessage: ChatMessage = {
                                type: "chatMessage",
                                messageType: "LLM",
                                text: `You said: ${json.text}`,
                                conversationId: conversationId
                            };
                            ws.send(JSON.stringify(chatMessage));

                        }

                    } else if (json.type === 'applyDiff') {
                        console.log("Apply Diff requested.");
                        const conversationId = json.conversationId;
                        try {
                            await this.codeProcessor.applyDiff(); // Call the applyDiff method
                            ws.send(JSON.stringify({ type: 'diffApplied', conversationId: conversationId }));
                        } catch (error: any) {
                            console.error("Error applying diff:", error);
                            const errorMessage: ErrorMessage = {
                                type: 'error',
                                message: 'Failed to apply diff',
                                details: error.message,
                                conversationId: conversationId
                            };
                            ws.send(JSON.stringify(errorMessage));

                        }
                    } else if (json.type === 'requestStatus') {
                        // Handle request status (if needed)
                    } else {
                        console.log("Unknown message type:", json.type);
                        const errorMessage: ErrorMessage = {
                            type: 'error',
                            message: 'Unknown message type',
                            details: JSON.stringify(json),
                            conversationId: conversationId
                        };
                        ws.send(JSON.stringify(errorMessage));
                    }
                } catch (error: any) {
                    console.error('Invalid JSON or other error:', error);

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

export { WebSocketServer };
