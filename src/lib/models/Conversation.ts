// lib/models/Conversation.ts (This remains the same)

export interface Message {
    role: 'user' | 'assistant' | 'system'; // Standard roles
    content: string;
}

export class Conversation {
    messages: Message[];

    constructor(initialMessages: Message[] = []) {
        this.messages = initialMessages;
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