// File: src/lib/ConversationManager.ts

import { Conversation } from "./models/Conversation";
import { v4 as uuidv4 } from 'uuid'; // Import a UUID generator

class ConversationManager {
    private static instance: ConversationManager | null = null;  // Static instance
    private conversations: { [conversationId: string]: Conversation } = {};

    private constructor() {
        // Private constructor to prevent direct instantiation
    }

    public static getInstance(): ConversationManager {
        if (!ConversationManager.instance) {
            ConversationManager.instance = new ConversationManager();
        }
        return ConversationManager.instance;
    }

    public createConversation(): { conversationId: string; conversation: Conversation } {
        const conversationId = uuidv4(); // Generate a unique ID
        const conversation = new Conversation();
        this.conversations[conversationId] = conversation;
        return { conversationId, conversation };
    }

    public getConversation(conversationId: string): Conversation | undefined {
        return this.conversations[conversationId];
    }

    public removeConversation(conversationId: string): void {
        delete this.conversations[conversationId];
    }

    public hasConversation(conversationId: string): boolean {
        return conversationId in this.conversations;
    }

    // For testing purposes ONLY - DO NOT USE IN PRODUCTION CODE
    public static resetInstance(): void {
        ConversationManager.instance = null;
    }
}

export { ConversationManager };