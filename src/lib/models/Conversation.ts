// File: src/lib/models/Conversation.ts

export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string; // Add timestamp
}

// Define the structure expected in the JSONL file (matches LogEntry from AIClient but simplified)
// **** ADD EXPORT HERE ****
export interface JsonlLogEntry {
    type: 'request' | 'response' | 'error' | string; // Allow other types if needed
    prompt?: string; // For 'request' - Keep for backward compatibility if needed
    response?: string; // For 'response' - Keep for backward compatibility if needed
    error?: string; // For 'error'
    content?: string; // Use content/role primarily now
    role?: 'user' | 'assistant' | 'system';
    timestamp: string;
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

    addMessage(role: 'user' | 'assistant' | 'system', content: string, timestamp?: string) {
        const messageTimestamp = timestamp || new Date().toISOString();
        this.messages.push({ role, content, timestamp: messageTimestamp });
    }

    getMessages(): Message[] {
        return this.messages;
    }

    getLastMessage(): Message | undefined {
        return this.messages.length > 0 ? this.messages[this.messages.length - 1] : undefined;
    }

    static fromJsonlData(jsonData: JsonlLogEntry[]): Conversation {
        const messages: Message[] = [];
        for (const entry of jsonData) {
            let role: Message['role'] | null = null;
            let content: string | null = null;

            // Prioritize role/content if present (matches new logging)
            if (entry.role && entry.content) {
                // Ensure role is one of the allowed types
                if (entry.role === 'user' || entry.role === 'assistant' || entry.role === 'system') {
                    role = entry.role;
                    content = entry.content;
                } else {
                    console.warn(`Skipping entry with unknown role: ${entry.role}`);
                    continue;
                }
            }
            // Fallback for older log format (optional)
            else if (entry.type === 'request' && entry.prompt) {
                role = 'user';
                content = entry.prompt;
            } else if (entry.type === 'response' && entry.response) {
                role = 'assistant';
                content = entry.response;
            } else if (entry.type === 'error' && entry.error) {
                console.warn(`Skipping error log entry during conversation load: ${entry.error}`);
                continue;
            }

            if (role && content !== null && content !== undefined) { // Ensure content exists
                messages.push({ role, content, timestamp: entry.timestamp });
            } else {
                console.warn("Could not parse log entry into a conversation message:", entry);
            }
        }
        return new Conversation(messages);
    }
}

export default Conversation;