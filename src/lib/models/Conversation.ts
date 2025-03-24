// src/lib/models/Conversation.ts
import { v4 as uuidv4 } from 'uuid'; // Import UUID generator

export interface Message {
    role: 'user' | 'assistant' | 'system'; // Standard roles  (you can remove 'system' if not used)
    content: string;
}

export class Conversation {
    private id: string; // Add an ID field
    private messages: Message[];

    constructor(id?: string) { // Make id optional
        this.id = id || uuidv4();  // Generate a unique ID if one isn't provided
        this.messages = [];
    }

    getId(): string {
        return this.id;
    }

    addMessage(role: 'user' | 'assistant' | 'system', content: string) {
        this.messages.push({ role, content });
    }

    getMessages(): Message[] {
        return this.messages;
    }

    getLastMessage(): Message | undefined {
        return this.messages.length > 0 ? this.messages[this.messages.length - 1] : undefined;
    }
    // Add other helpful methods as needed
}

export default Conversation;