// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient';
import { Config } from "./Config";
// --- MODIFICATION: Remove UserInterface import if no longer needed for other methods ---
// import { UserInterface } from './UserInterface';
// --- MODIFICATION: Import SublimeEditorInteraction ---
import { SublimeEditorInteraction } from './ui/SublimeEditorInteraction';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { toSnakeCase, countTokens } from './utils'; // countTokens might not be needed here anymore
import chalk from 'chalk';
import { ProjectContextBuilder } from './ProjectContextBuilder';
import { ConsolidationService } from './ConsolidationService';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
const exec = promisify(execCb); // Promisify for async/await usage

// --- MODIFICATION: Remove ConversationPaths interface if editorFilePath is no longer needed here ---
// interface ConversationPaths {
//     conversationFilePath: string;
//     editorFilePath: string; // <-- This part is removed
// }

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    // --- MODIFICATION: Remove ui instance if fully replaced by specific interactions ---
    // ui: UserInterface;
    // --- MODIFICATION: Add sublimeInteraction instance ---
    sublimeInteraction: SublimeEditorInteraction;
    projectRoot: string;
    private readonly CONSOLIDATE_COMMAND = '/consolidate';
    private contextBuilder: ProjectContextBuilder;
    private consolidationService: ConsolidationService;

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);
        // --- MODIFICATION: Instantiate SublimeEditorInteraction ---
        // Pass fs and config as dependencies
        this.sublimeInteraction = new SublimeEditorInteraction(this.fs, this.config);
        // this.ui = new UserInterface(config); // <-- Remove if not used elsewhere
        this.projectRoot = process.cwd();
        this.contextBuilder = new ProjectContextBuilder(this.fs, this.projectRoot, this.config);
        this.consolidationService = new ConsolidationService(this.config, this.fs, this.aiClient, this.projectRoot);
    }

    // --- REMOVED buildContextString method ---
    // It's now handled entirely by ProjectContextBuilder instance

    optimizeWhitespace(code: string): string {
        // Keep this utility if needed elsewhere
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\r\n/g, '\n');
        code = code.replace(/\n{3,}/g, '\n\n');
        code = code.trim();
        return code;
    }

    // --- Main Conversation Orchestration ---
    async startConversation(conversationName: string, isNew: boolean): Promise<void> {
        // --- MODIFICATION: Only need conversation file path ---
        const conversationFilePath = this._getConversationFilePath(conversationName);
        // let editorFilePathForCleanup: string | null = null; // <-- REMOVED
        let conversation: Conversation;

        try {
            conversation = await this._loadOrCreateConversation(conversationName, isNew, conversationFilePath);
            // editorFilePathForCleanup = paths.editorFilePath; // <-- REMOVED

            // Start the main interaction loop
            // --- MODIFICATION: Pass only necessary arguments ---
            await this._handleUserInputLoop(conversationName, conversation, conversationFilePath);

            console.log(`\nExiting conversation "${conversationName}".`);

        } catch (error) {
            // --- MODIFICATION: Pass conversationFilePath directly ---
            await this._handleConversationError(error, conversationName, conversationFilePath);
        } finally {
            // --- MODIFICATION: Cleanup is handled by SublimeEditorInteraction ---
            // await this._cleanupEditorFile(editorFilePathForCleanup); // <-- REMOVED
            console.log(chalk.dim(`Editor file cleanup handled internally by SublimeEditorInteraction.`));
        }
    }

    // --- Private Helper Methods ---

    /** Generates ONLY the conversation file path. */
    private _getConversationFilePath(conversationName: string): string {
        const snakeName = toSnakeCase(conversationName);
        const conversationFileName = `${snakeName}.jsonl`;
        return path.join(this.config.chatsDir, conversationFileName);
    }

    /** Loads conversation from file or creates a new one. (Unchanged) */
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

    /** Manages the main loop of interacting with the user via the Sublime editor. */
    private async _handleUserInputLoop(
        conversationName: string,
        conversation: Conversation,
        // --- MODIFICATION: No longer needs `paths` - just the conversation file path ---
        conversationFilePath: string
    ): Promise<void> {
        while (true) {
            // --- MODIFICATION: Use SublimeEditorInteraction ---
            const interactionResult = await this.sublimeInteraction.getPrompt(
                conversationName,
                conversation.getMessages()
                // No editorFilePath needed here, it's managed internally now
            );
            // --- END MODIFICATION ---

            if (interactionResult.newPrompt === null) {
                break; // User exited editor or provided no prompt
            }

            await this._processLoopIteration(
                conversation,
                interactionResult.newPrompt,
                conversationFilePath // Pass conversation file path
            );
        }
    }

    /** Processes a single iteration of the user input loop. (Unchanged) */
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

    /** Handles the '/consolidate' command. (Unchanged) */
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
            const { context: currentContextString } = await this.contextBuilder.build(); // Use the builder

            // Delegate to the consolidation service
            await this.consolidationService.process(
                conversationName,
                conversation,
                currentContextString,
                conversationFilePath
            );
            conversation.addMessage('system', `[Consolidation process triggered for '${conversationName}' has finished. See logs.]`);
        } catch (consolidationError) {
            console.error(chalk.red(`Error during consolidation triggered by command:`), consolidationError);
            const errorMsg = `[System Error during consolidation: ${(consolidationError as Error).message}]`;
            conversation.addMessage('system', errorMsg);
            try {
                await this.aiClient.logConversation(conversationFilePath, { type: 'error', role: 'system', error: errorMsg });
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation command error:"), logErr);
            }
        }
    }

    /** Builds context and calls the AI for a standard user prompt. (Unchanged) */
    private async _callAIWithContext(
        conversation: Conversation,
        userPrompt: string,
        conversationFilePath: string
    ): Promise<void> {
        conversation.addMessage('user', userPrompt); // Add user message first

        try {
            const { context: currentContextString } = await this.contextBuilder.build();

            await this.aiClient.getResponseFromAI(
                conversation,
                conversationFilePath,
                currentContextString,
                false // TODO: Make 'useFlashModel' parameter configurable if needed
            );

        } catch (aiError) {
            console.error(chalk.red("Error during AI interaction:"), aiError);
            // Add specific error message to conversation for user feedback
            const errorMessage = `[System Error during AI request: ${(aiError as Error).message}. You can try again or exit.]`;
            conversation.addMessage('system', errorMessage);
            // Log the detailed error to the file (handled by getResponseFromAI internally, but log system message too)
            try {
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: errorMessage });
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log AI error system message:"), logErr);
            }
            // Do not rethrow here, allow the loop to continue
        }
    }

    /** Handles errors occurring during the main conversation loop. (Unchanged) */
    private async _handleConversationError(
        error: unknown,
        conversationName: string,
        conversationFilePath: string | null // Can be null if error happens before path is set
    ): Promise<void> {
        console.error(chalk.red(`\nAn unexpected error occurred in conversation "${conversationName}":`), error);
        if (conversationFilePath && this.aiClient) { // Check aiClient exists
            try {
                const logPayload: LogEntryData = {
                    type: 'error',
                    role: 'system', // Indicate error is from the system processing
                    error: `CodeProcessor loop error: ${(error as Error).message}`
                };
                await this.aiClient.logConversation(conversationFilePath, logPayload);
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log CodeProcessor error:"), logErr);
            }
        } else {
            console.error(chalk.red("Could not log error to conversation file (path or AI client unavailable)."));
        }
    }

    // --- MODIFICATION: Remove _cleanupEditorFile as it's handled by SublimeEditorInteraction ---
    // private async _cleanupEditorFile(editorFilePath: string | null): Promise<void> { ... }

    // --- Consolidation Orchestration Method (Unchanged from previous state) ---
    async processConsolidationRequest(conversationName: string): Promise<void> {
        // --- MODIFICATION: Use updated path helper ---
        const conversationFilePath = this._getConversationFilePath(conversationName);
        let conversation: Conversation;

        try {
            // Load conversation data
            const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
            conversation = Conversation.fromJsonlData(logData);
            if (conversation.getMessages().length === 0) {
                console.warn(chalk.yellow("Conversation is empty, cannot consolidate."));
                return;
            }

            // Build context string using the builder
            console.log(chalk.cyan("Fetching fresh codebase context for consolidation..."));
            const { context: currentContextString } = await this.contextBuilder.build();

            // Delegate *entirely* to the ConsolidationService
            await this.consolidationService.process(
                conversationName,
                conversation,
                currentContextString,
                conversationFilePath
            );

        } catch (error) {
            // Log error specific to triggering the consolidation
            console.error(chalk.red(`\n❌ Error triggering consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation setup: ${(error as Error).message}. See console for details.`;
            try {
                const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                await this.aiClient.logConversation(conversationFilePath, logPayload);
            } catch (logErr) { console.error(chalk.red("Additionally failed to log consolidation setup error:"), logErr); }
        }
    }
}

export { CodeProcessor };