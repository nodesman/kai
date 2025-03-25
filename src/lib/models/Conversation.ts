// src/lib/models/Conversation.ts
import { v4 as uuidv4 } from 'uuid';

export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export class Conversation {
    private id: string;
    private messages: Message[];

    constructor(id?: string, initialMessages?: Message[]) { // Make id and initialMessages optional
        this.id = id || uuidv4();
        this.messages = initialMessages || []; // Initialize with provided messages, or an empty array
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