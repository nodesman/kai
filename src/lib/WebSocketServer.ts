// File: src/lib/WebSocketServer.ts

import WebSocket from 'ws';
import { CodeProcessor } from './codeprocessor/CodeProcessor';
import { Config } from './Config';
import { DiffFile } from './types';
import { Conversation } from "./models/Conversation";
import { IncomingMessage } from 'http';
import { ConversationManager } from './ConversationManager';

// --- Message Interfaces ---

interface Message {
    type: string;
    conversationId?: string; // Conversation ID is optional in the base interface
}

interface ChatMessage extends Message {
    messageType: string;
    text: string;
}

interface DiffResult extends Message {
    files: DiffFile[];
}

interface ExplanationMessage extends Message {
    explanation: string;
}

interface DiffCheckResult extends Message {
    hasDiff: boolean;
}

interface CommentCheckResult extends Message {
    hasComments: boolean;
}

interface ErrorMessage extends Message {
    message: string;
    details: string;
}

interface DiffAppliedMessage extends Message {
    // Can add details about the applied diff, if needed
}

interface ReadyMessage extends Message {}

interface NewConversationMessage extends Message {
    // Specifically for informing the client of a new conversation ID
}

interface InitialConversationMessage extends Message {
    // Specifically for the initial conversation ID.
}

interface InitialConversationIdMessage extends Message {
}

// --- WebSocketServer Class ---
class WebSocketServer {
    private webSocketServer: WebSocket.Server;
    private codeProcessor: CodeProcessor;
    private conversationManager: ConversationManager;

    constructor(config: Config) {
        this.webSocketServer = new WebSocket.Server({ port: 8080 });
        this.codeProcessor = new CodeProcessor(config);
        this.conversationManager = ConversationManager.getInstance();
        this.setupConnectionHandler();
    }

    private setupConnectionHandler() {
        this.webSocketServer.on('connection', this.handleConnection.bind(this));
        console.log('WebSocket server listening on port 8080');
    }

    private handleConnection(webSocket: WebSocket, request: IncomingMessage) {
        const ipAddress = this.getClientIpAddress(request);
        console.log(`Client connected from ${ipAddress}`);

        // 1. Create conversation and get ID
        const { conversationId } = this.conversationManager.createConversation();

        // 2. *Crucially* store the conversationId on the WebSocket itself.
        // @ts-ignore
        webSocket.conversationId = conversationId;

        // 3. Send the initial conversationId to the client.
        this.sendMessage(webSocket, { type: 'initialConversationId', conversationId } as InitialConversationIdMessage);

        // Set up event listeners.  No closures needed now!
        webSocket.on('message', this.handleMessage.bind(this, webSocket));
        webSocket.on('close', this.handleDisconnection.bind(this, webSocket, ipAddress));
        webSocket.on('error', this.handleWebSocketError.bind(this, webSocket, ipAddress));
    }

    private getClientIpAddress(request: IncomingMessage): string {
        return request.socket.remoteAddress || 'unknown';
    }

    private async handleMessage(webSocket: WebSocket, message: string) {
        // Now we can access conversationId DIRECTLY from the webSocket object.

        // @ts-ignore
        const conversationId = webSocket.conversationId;

        // This should NEVER happen, but it's a good safety check.
        if (!conversationId) {
            console.error("WebSocket connection has no associated conversationId!");
            this.sendError(webSocket, "Internal Server Error", "No conversation associated with this connection.", undefined);
            return; // Stop processing
        }

        console.log(`Message received for conversationId: ${conversationId}`);
        console.log(`Received: ${message}`);

        try {
            const json: Message = this.parseMessage(message);

            switch (json.type) {
                case 'ready':
                    console.log("Qt Client is ready!");
                    break;
                case 'chatMessage':
                    // Pass the conversationId, even though we could access it from the WebSocket, it's clearer.
                    await this.handleChatMessage(webSocket, json as ChatMessage, conversationId);
                    break;
                case 'applyDiff':
                    await this.handleApplyDiff(webSocket, conversationId);
                    break;
                case 'requestStatus':
                    // Handle request status
                    break;
                default:
                    console.log("Unknown message type:", json.type);
                    this.sendError(webSocket, 'Unknown message type', JSON.stringify(json), conversationId);
            }
        } catch (error: any) {
            console.error('Invalid JSON or other error:', error);
            //We can still try and send back an error with the conversation Id
            this.sendError(webSocket, 'Invalid JSON or other error', error.message, conversationId);
        }
    }

    private parseMessage(message: string): Message {
        try {
            return JSON.parse(message);
        } catch (error) {
            throw new Error('Invalid JSON format');
        }
    }

    private handleDisconnection(webSocket: WebSocket, ipAddress: string) {
        console.log(`Client ${ipAddress} disconnected`);
        // @ts-ignore
        const conversationId = webSocket.conversationId; // Get conversationId
        if (conversationId) {
            this.conversationManager.removeConversation(conversationId);
        }
    }

    private handleWebSocketError(webSocket: WebSocket, ipAddress: string, error: Error) {
        console.error(`WebSocket error from ${ipAddress}:`, error);
    }

    private async handleChatMessage(webSocket: WebSocket, json: ChatMessage, conversationId: string) {
        console.log(`Chat message from ${json.messageType}: ${json.text}`);
        const conversation = this.conversationManager.getConversation(conversationId);

        // Add the user message to the conversation.
        if (json.messageType === "User") {
            // Echo the user's message back (optional, but good for UI feedback).
            this.sendMessage(webSocket, { type: "chatMessage", messageType: "User", text: json.text } as ChatMessage);

            const aiResponse = await this.codeProcessor.askQuestion(json.text, conversation!);
            // Send the LLM's response.
            this.sendMessage(webSocket, { type: "chatMessage", messageType: "LLM", text: aiResponse.message } as ChatMessage);

            const commentCheckPrompt = `Does the following text contain comments? Respond with "true" or "false".\n\n${aiResponse.message}`;
            const commentCheckResponse = await this.codeProcessor.checkResponse(commentCheckPrompt);
            const hasComments = commentCheckResponse.toLowerCase().includes("true");
            this.sendMessage(webSocket, { type: "commentCheckResult", hasComments: hasComments } as CommentCheckResult);

            if (aiResponse.explanation) {
                this.sendMessage(webSocket, { type: "explanation", explanation: aiResponse.explanation } as ExplanationMessage);
            }

            if (aiResponse.diffFiles) {
                this.codeProcessor.setCurrentDiff(aiResponse.diffFiles);
                this.sendMessage(webSocket, { type: 'diffResult', files: aiResponse.diffFiles } as DiffResult);
            }
        } else {
            this.sendMessage(webSocket, { type: "chatMessage", messageType: "LLM", text: `You said: ${json.text}` } as ChatMessage);
        }
    }

    private async handleApplyDiff(webSocket: WebSocket, conversationId: string) {
        console.log("Apply Diff requested.");
        try {
            await this.codeProcessor.applyDiff();
            this.sendMessage(webSocket, { type: 'diffApplied', conversationId: conversationId } as DiffAppliedMessage);
        } catch (error: any) {
            console.error("Error applying diff:", error);
            this.sendError(webSocket, 'Failed to apply diff', error.message, conversationId);
        }
    }

    private sendMessage(webSocket: WebSocket, message: Message) {
        webSocket.send(JSON.stringify(message));
    }

    private sendError(webSocket: WebSocket, errorMessage: string, details: string, conversationId: string | undefined) {
        const errorObject: ErrorMessage = {type: "error", message: errorMessage, details};

        if(conversationId) {
            errorObject.conversationId = conversationId
        }
        this.sendMessage(webSocket, errorObject);
    }
}

export { WebSocketServer };