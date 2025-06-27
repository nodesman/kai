// src/lib/ConversationManager.ts
import path from 'path';
import crypto from 'crypto';
import chalk from 'chalk';
import { Config } from './Config';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient';
import { UserInterface } from './UserInterface';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { ProjectContextBuilder } from './ProjectContextBuilder';
import { ConsolidationService } from './consolidation/ConsolidationService';
import { toSnakeCase } from './utils';

// Interface for paths managed within the conversation session
interface ConversationPaths {
    conversationFilePath: string;
    editorFilePath: string;
}

export class ConversationManager {
    private config: Config;
    private fs: FileSystem;
    private aiClient: AIClient;
    private ui: UserInterface;
    private contextBuilder: ProjectContextBuilder;
    private consolidationService: ConsolidationService; // Keep for /consolidate command

    private readonly CONSOLIDATE_COMMAND = '/consolidate';

    constructor(
        config: Config,
        fs: FileSystem,
        aiClient: AIClient,
        ui: UserInterface,
        contextBuilder: ProjectContextBuilder,
        consolidationService: ConsolidationService // Pass the existing service
    ) {
        this.config = config;
        this.fs = fs;
        this.aiClient = aiClient;
        this.ui = ui;
        this.contextBuilder = contextBuilder;
        this.consolidationService = consolidationService;
    }

    /**
     * Updates the AI client used for conversations and consolidation.
     */
    updateAIClient(aiClient: AIClient): void {
        this.aiClient = aiClient;
    }

    /**
     * Runs the main interactive conversation session for a given conversation name.
     * @param conversationName The user-facing name of the conversation.
     * @param isNew Whether this is a newly created conversation.
     */
    async runSession(conversationName: string, isNew: boolean): Promise<void> {
        const paths = this._getConversationPaths(conversationName);
        let editorFilePathForCleanup: string | null = null; // Separate variable for finally block
        let conversation: Conversation;

        try {
            conversation = await this._loadOrCreateConversation(conversationName, isNew, paths.conversationFilePath);
            editorFilePathForCleanup = paths.editorFilePath; // Assign path for potential cleanup

            // Start the main interaction loop
            await this._handleUserInputLoop(conversationName, conversation, paths);

            console.log(`\nExiting conversation "${conversationName}".`);

        } catch (error) {
            await this._handleConversationError(error, conversationName, paths.conversationFilePath);
        } finally {
            // Use the path stored specifically for cleanup
            await this._cleanupEditorFile(editorFilePathForCleanup);
        }
    }

    // --- Private Helper Methods (Moved from CodeProcessor) ---

    /** Generates the file paths related to a conversation. */
    private _getConversationPaths(conversationName: string): ConversationPaths {
        const snakeName = toSnakeCase(conversationName);
        const conversationFileName = `${snakeName}.jsonl`;
        const editorFileName = `${snakeName}_edit.txt`;
        return {
            conversationFilePath: path.join(this.config.chatsDir, conversationFileName),
            editorFilePath: path.join(this.config.chatsDir, editorFileName),
        };
    }

    /** Loads conversation from file or creates a new one. */
    private async _loadOrCreateConversation(
        conversationName: string,
        isNew: boolean,
        conversationFilePath: string
    ): Promise<Conversation> {
        if (!isNew) {
            try {
                const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
                const conversation = Conversation.fromJsonlData(logData);
                console.log(chalk.blue(`Loaded ${conversation.getMessages().length} messages for conversation: ${chalk.cyan(conversationName)}.`));
                return conversation;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    console.warn(chalk.yellow(`Warning: Conversation file not found for "${conversationName}". Starting a new conversation instead.`));
                    // Fall through to create a new conversation
                } else {
                    throw error; // Rethrow unexpected errors
                }
            }
        }
        // Create new conversation if isNew is true or if loading failed with ENOENT
        console.log(chalk.blue(`Starting new conversation: ${chalk.cyan(conversationName)}`));
        return new Conversation();
    }

    /** Manages the main loop of interacting with the user via the editor. */
    private async _handleUserInputLoop(
        conversationName: string,
        conversation: Conversation,
        paths: ConversationPaths
    ): Promise<void> {
        while (true) {
            // Use the injected ui instance
            const interactionResult = await this.ui.getPromptViaSublimeLoop(
                conversationName,
                conversation.getMessages(),
                paths.editorFilePath // Pass editor path explicitly
            );

            if (interactionResult.newPrompt === null) {
                break; // User exited editor or provided no prompt
            }

            await this._processLoopIteration(
                conversation,
                interactionResult.newPrompt,
                paths.conversationFilePath
            );
        }
    }

    /** Processes a single iteration of the user input loop. */
    private async _processLoopIteration(
        conversation: Conversation,
        userPrompt: string,
        conversationFilePath: string
    ): Promise<void> {
        // Handle /consolidate command
        if (userPrompt.trim().toLowerCase() === this.CONSOLIDATE_COMMAND) {
            await this._handleConsolidateCommand(conversation, conversationFilePath);
            // No 'continue' needed here as it's the last step in this iteration path
        } else {
            // Handle normal AI interaction
            await this._callAIWithContext(conversation, userPrompt, conversationFilePath);
        }
    }

    /** Handles the '/consolidate' command within the chat loop. */
    private async _handleConsolidateCommand(
        conversation: Conversation,
        conversationFilePath: string
    ): Promise<void> {
        const conversationName = path.basename(conversationFilePath, '.jsonl'); // Extract name
        console.log(chalk.yellow(`🚀 Intercepted ${this.CONSOLIDATE_COMMAND}. Starting consolidation process...`));
        conversation.addMessage('user', this.CONSOLIDATE_COMMAND); // Add command itself
        try {
            await this.aiClient.logConversation(conversationFilePath, { type: 'request', role: 'user', content: this.CONSOLIDATE_COMMAND });
        } catch (logErr) {
            console.error(chalk.red("Error logging consolidate command:"), logErr);
        }

        try {
            // Fetch fresh context using the builder
            console.log(chalk.cyan("  Fetching fresh codebase context for consolidation..."));
            // Use the injected contextBuilder instance
            // NOTE: Consolidation currently ALWAYS uses the default buildContext (full or cache)
            // It does NOT yet support the 'dynamic' context mode.
            const { context: currentContextString } = await this.contextBuilder.buildContext();

            // Delegate to the *injected* consolidation service
            await this.consolidationService.process(
                conversationName,
                conversation, // Pass the current state of the conversation object
                currentContextString,
                conversationFilePath
            );
            // Note: ConsolidationService internally adds its own success/failure messages to the log file.
            // We add a message to the *in-memory* conversation object for context in the ongoing chat.
            const successMarker = conversation.getMessages().some(m => m.role === 'system' && m.content.includes("Consolidation Completed Successfully")); // Quick check if service logged success
            const systemMessage = successMarker
                ? `[System: Consolidation process triggered for '${conversationName}' completed successfully. See logs for details.]`
                : `[System: Consolidation process triggered for '${conversationName}' finished (potentially with errors). See logs for details.]`;
            conversation.addMessage('system', systemMessage); // Clarify message in live chat

        } catch (consolidationError) {
            console.error(chalk.red(`Error during consolidation triggered by command:`), consolidationError);
            const errorMsg = `[System Error during '/consolidate' command: ${(consolidationError as Error).message}. Check logs.]`;
            conversation.addMessage('system', errorMsg); // Add error to live chat
            try {
                // Also log the error explicitly to the file
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: `Error during /consolidate command execution: ${errorMsg}` });
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation command error:"), logErr);
            }
        }
    }

    /** Builds context (dynamically or standard) and calls the AI for a standard user prompt. */
    private async _callAIWithContext(
        conversation: Conversation,
        userPrompt: string,
        conversationFilePath: string
    ): Promise<void> {
        conversation.addMessage('user', userPrompt); // Add user message first

        let contextResult: { context: string; tokenCount: number };
        const currentMode = this.config.context.mode;

        try {
            // --- Select Context Building Strategy ---
            console.log(chalk.blue(`\nBuilding context using mode: ${currentMode}...`));
            if (currentMode === 'dynamic') {
                 const history = conversation.getMessages(); // Get current history
                 // --- FIX: Summarize history before passing ---
                 const historySummary = this._summarizeHistory(history);
                 contextResult = await this.contextBuilder.buildDynamicContext(userPrompt, historySummary);
            } else {
                 // Use standard context building for 'full' or 'analysis_cache' modes
                 // buildContext() internally checks mode again and fetches appropriate context
                 contextResult = await this.contextBuilder.buildContext();
            }
            // --- End Context Building Strategy ---

            // Determine if flash model should be used (e.g., based on config or logic)
            // For now, defaulting to false (use primary model) for standard chat.
            const useFlashModel = false; // Example: could check config later

            // Use the injected aiClient instance
             await this.aiClient.getResponseFromAI( // Pass the fetched context
                conversation,
                conversationFilePath,
                contextResult.context, // Pass the potentially dynamic context string
                useFlashModel
            );
            // AIClient internally adds the assistant response to the conversation object

        } catch (aiError) {
            console.error(chalk.red("Error during AI interaction:"), aiError);
            // Add specific error message to conversation for user feedback
            // Check if the error originated during context building
             if (aiError instanceof Error && (aiError.message.includes('Cannot build context') || aiError.message.includes('Error during AI relevance check') || aiError.message.includes('User query is required for'))) {
                 // Error likely from context building, log that specifically
                 conversation.addMessage('system', `[System Error building context for AI request: ${(aiError as Error).message}. You can try again or exit.]`);
             } else {
                  // General AI request error
                 const errorMessage = `[System Error during AI request: ${(aiError as Error).message}. You can try again or exit.]`;
                 conversation.addMessage('system', errorMessage);
             }
            // Log the detailed error to the file (AIClient might already do this, but being explicit here)
            try {
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: `AI Interaction Error: ${(aiError as Error).message}` });
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log AI error system message:"), logErr);
            }
            // Do not rethrow here, allow the loop to continue
        }
    }

    /** Handles errors occurring during the main conversation loop. */
    private async _handleConversationError(
        error: unknown,
        conversationName: string,
        conversationFilePath: string | null // Can be null if error happens before path is set
    ): Promise<void> {
        console.error(chalk.red(`\nAn unexpected error occurred in conversation "${conversationName}":`), error);
        if (conversationFilePath && this.aiClient) {
            try {
                const logPayload: LogEntryData = {
                    type: 'error',
                    role: 'system', // Indicate error is from the system processing
                    error: `ConversationManager loop error: ${(error as Error).message}`
                };
                await this.aiClient.logConversation(conversationFilePath, logPayload);
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log ConversationManager error:"), logErr);
            }
        } else {
            console.error(chalk.red("Could not log error to conversation file (path or AI client unavailable)."));
        }
    }

    /** Cleans up the temporary editor file. */
    private async _cleanupEditorFile(editorFilePath: string | null): Promise<void> {
        if (editorFilePath) {
            try {
                await this.fs.access(editorFilePath);
                await this.fs.deleteFile(editorFilePath);
                console.log(chalk.dim(`Cleaned up editor file: ${editorFilePath}`));
            } catch (cleanupError) {
                // Only log errors that aren't "file not found"
                if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.warn(chalk.yellow(`\nWarning: Failed to clean up editor file ${editorFilePath}:`), cleanupError);
                } else {
                    console.log(chalk.dim(`Editor file already gone: ${editorFilePath}`));
                }
            }
        }
    }

    /** Creates a simple summary of conversation history for dynamic context */
    private _summarizeHistory(history: Message[]): string | null {
         // Placeholder: Implement actual history summarization based on your Message structure
         if (!history || history.length === 0) return null;
         const recentMessages = history.slice(-4); // Take last 4 messages? Needs tuning.
         let summary = "Recent conversation highlights:\n";
         recentMessages.forEach((msg: Message) => {
              const contentPreview = typeof msg.content === 'string'
                   ? `${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`
                   : '[Non-text content]';
              summary += `  ${msg.role}: ${contentPreview}\n`;
         });
         return summary;
    }
}

 // REMOVED: Redundant export statement