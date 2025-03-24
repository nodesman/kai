// File: src/lib/WebSocketServer.ts

import WebSocket from 'ws';
import { CodeProcessor } from './CodeProcessor';
import { Config } from './Config';
import { DiffFile } from './types';
import { Conversation } from "./models/Conversation";
import { IncomingMessage } from 'http';
import { ConversationManager } from './ConversationManager';

// --- Message Interfaces ---

interface Message {
    type: string;
    conversationId?: string; // conversationId is now ALWAYS optional in the base interface
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
    // Can add details
}

interface ReadyMessage extends Message {}

// --- WebSocketServer Class ---

class WebSocketServer {
    private wss: WebSocket.Server;
    private codeProcessor: CodeProcessor;
    private conversationManager: ConversationManager;

    constructor(config: Config) {
        this.wss = new WebSocket.Server({ port: 8080 });
        this.codeProcessor = new CodeProcessor(config);
        this.conversationManager = new ConversationManager();
        this.setupConnectionHandler();
    }

    private setupConnectionHandler() {
        this.wss.on('connection', this.handleConnection.bind(this));
        console.log('WebSocket server listening on port 8080');
    }

    private handleConnection(ws: WebSocket, req: IncomingMessage) {
        const ip = this.getClientIp(req);
        console.log(`Client connected from ${ip}`);

        // Create a new conversation and send the ID to the client
        const { conversationId } = this.conversationManager.createConversation();
        this.sendMessage(ws, { type: "initialConversationId", conversationId: conversationId }); // Send initial ID

        ws.on('message', this.handleMessage.bind(this, ws));
        ws.on('close', this.handleDisconnection.bind(this, ws, ip));
        ws.on('error', this.handleWsError.bind(this, ws, ip));
    }

    private getClientIp(req: IncomingMessage): string {
        return req.socket.remoteAddress || 'unknown';
    }

    private async handleMessage(ws: WebSocket, message: string) {
        console.log(`Received: ${message}`);

        try {
            const json: Message = this.parseMessage(message);
            let conversationId = json.conversationId;
            let conversation = null;

            // Validate and/or create conversation
            if (conversationId) {
                conversation = this.conversationManager.getConversation(conversationId);
                if (!conversation) {
                    console.warn(`Invalid conversationId received: ${conversationId}.  Creating a new conversation.`);
                    const newConversation = this.conversationManager.createConversation();
                    conversationId = newConversation.conversationId;
                    conversation = newConversation.conversation;
                    // Inform the client about the new ID
                    this.sendMessage(ws, { type: "newConversationId", conversationId: conversationId });
                }
            } else {
                // No conversationId provided - create a new one and inform the client
                console.warn(`No conversationId received. Creating a new conversation.`);
                const newConversation = this.conversationManager.createConversation();
                conversationId = newConversation.conversationId;
                conversation = newConversation.conversation;
                this.sendMessage(ws, { type: "newConversationId", conversationId: conversationId });
            }
            switch (json.type) {
                case 'ready':
                    console.log("Qt Client is ready!");
                    break;
                case 'chatMessage':
                    await this.handleChatMessage(ws, json as ChatMessage, conversationId);
                    break;
                case 'applyDiff':
                    await this.handleApplyDiff(ws, conversationId);
                    break;
                case 'requestStatus':
                    // Handle if needed
                    break;
                default:
                    console.log("Unknown message type:", json.type);
                    this.sendError(ws, 'Unknown message type', JSON.stringify(json), conversationId);
            }

        } catch (error: any) {
            console.error('Invalid JSON or other error:', error);
            //In case of error, we DO NOT know the conversation.
            this.sendError(ws, 'Invalid JSON or other error', error.message, undefined);
        }
    }
    private parseMessage(message: string): Message {
        try {
            return JSON.parse(message);
        } catch (error) {
            throw new Error('Invalid JSON format');
        }
    }
    //Modified
    private handleDisconnection(ws: WebSocket, ip: string) {
        console.log(`Client ${ip} disconnected`);
        // No specific cleanup needed here, as conversations are not tied to the WebSocket
    }

    private handleWsError(ws: WebSocket, ip: string, error: Error) {
        console.error(`WebSocket error from ${ip}:`, error);
    }

    private async handleChatMessage(ws: WebSocket, json: ChatMessage, conversationId: string) {
        console.log(`Chat message from ${json.messageType}: ${json.text}`);
        const conversation = this.conversationManager.getConversation(conversationId);
        //We checked for null in handleMessage.  It cannot be null now.

        if (json.messageType === "User") {
            this.sendMessage(ws, { type: "chatMessage", messageType: "User", text: json.text, conversationId: conversationId } as ChatMessage);

            const aiResponse = await this.codeProcessor.askQuestion(json.text, conversation!);
            this.sendMessage(ws, { type: "chatMessage", messageType: "LLM", text: aiResponse.message, conversationId: conversationId } as ChatMessage);

            const commentCheckPrompt = `Does the following text contain comments? Respond with "true" or "false".\n\n${aiResponse.message}`;
            const commentCheckResponse = await this.codeProcessor.checkResponse(commentCheckPrompt);
            const hasComments = commentCheckResponse.toLowerCase().includes("true");
            this.sendMessage(ws, { type: "commentCheckResult", hasComments: hasComments, conversationId: conversationId } as CommentCheckResult);

            if (aiResponse.explanation) {
                this.sendMessage(ws, { type: "explanation", explanation: aiResponse.explanation, conversationId: conversationId } as ExplanationMessage);
            }

            if (aiResponse.diffFiles) {
                this.codeProcessor.setCurrentDiff(aiResponse.diffFiles);
                this.sendMessage(ws, { type: 'diffResult', files: aiResponse.diffFiles, conversationId: conversationId } as DiffResult);
            }
        } else {
            this.sendMessage(ws, { type: "chatMessage", messageType: "LLM", text: `You said: ${json.text}`, conversationId: conversationId } as ChatMessage);
        }
    }


    private async handleApplyDiff(ws: WebSocket, conversationId: string) {
        console.log("Apply Diff requested.");
        try {
            await this.codeProcessor.applyDiff();
            this.sendMessage(ws, { type: 'diffApplied', conversationId: conversationId } as DiffAppliedMessage);
        } catch (error: any) {
            console.error("Error applying diff:", error);
            this.sendError(ws, 'Failed to apply diff', error.message, conversationId);
        }
    }

    private sendMessage(ws: WebSocket, message: Message) {
        ws.send(JSON.stringify(message));
    }

    private sendError(ws: WebSocket, message: string, details: string, conversationId: string | undefined) {
        const errorMessage: ErrorMessage = { type: 'error', message, details, conversationId };
        this.sendMessage(ws, errorMessage);
    }
}

export { WebSocketServer };