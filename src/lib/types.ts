//File: src/lib/types.ts
// Add to src/lib/types.ts
export interface DiffFile {
    path: string;
    content: string; // This is now the *diff content*, not the entire file content
}

export interface Message {
    type: string;
    conversationId?: string; // Conversation ID is optional in the base interface
}

export interface ChatMessage extends Message {
    messageType: string;
    text: string;
}

export interface DiffResult extends Message {
    files: DiffFile[];
}

export interface ExplanationMessage extends Message {
    explanation: string;
}

export interface DiffCheckResult extends Message {
    hasDiff: boolean;
}

export interface CommentCheckResult extends Message {
    hasComments: boolean;
}

export interface ErrorMessage extends Message {
    message: string;
    details: string;
}

export interface DiffAppliedMessage extends Message {
    // Can add details about the applied diff, if needed
}

export interface ReadyMessage extends Message {}

export interface NewConversationMessage extends Message {
    // Specifically for informing the client of a new conversation ID
}

export interface InitialConversationMessage extends Message {
    // Specifically for the initial conversation ID.
}

export interface InitialConversationIdMessage extends Message {
}