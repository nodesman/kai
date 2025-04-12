// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient';
import { Config } from "./Config";
import { UserInterface } from './UserInterface';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { toSnakeCase, countTokens } from './utils'; // countTokens might not be needed here anymore
import chalk from 'chalk';
import { ProjectContextBuilder } from './ProjectContextBuilder';
import { ConsolidationService } from './ConsolidationService';
// REMOVE child_process imports as CommandService handles execution
// import { exec as execCb } from 'child_process';
// import { promisify } from 'util';
// const exec = promisify(execCb);

// --- Import the new services ---
import { CommandService } from './CommandService';
import { GitService } from './GitService';
// --- End imports ---


// Interface for paths managed within the conversation
interface ConversationPaths {
    conversationFilePath: string;
    editorFilePath: string;
}

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    ui: UserInterface;
    projectRoot: string;
    private readonly CONSOLIDATE_COMMAND = '/consolidate';
    private contextBuilder: ProjectContextBuilder;
    private consolidationService: ConsolidationService;
    // --- Add service instance variables ---
    private commandService: CommandService;
    private gitService: GitService;
    // --- End service instance variables ---

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);
        this.ui = new UserInterface(config);
        this.projectRoot = process.cwd();
        this.contextBuilder = new ProjectContextBuilder(this.fs, this.projectRoot, this.config);

        // --- Instantiate services ---
        this.commandService = new CommandService();
        this.gitService = new GitService(this.commandService); // Pass CommandService to GitService
        // --- End service instantiation ---

        // Pass GitService to ConsolidationService
        this.consolidationService = new ConsolidationService(
            this.config,
            this.fs,
            this.aiClient,
            this.projectRoot,
            this.gitService // Pass the created GitService instance
        );
    }

    // --- REMOVED buildContextString method ---
    // It's now handled entirely by ProjectContextBuilder instance

    optimizeWhitespace(code: string): string {
        // Keep this utility if needed elsewhere, or move it if only used in the deleted buildContextString
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\r\n/g, '\n');
        code = code.replace(/\n{3,}/g, '\n\n');
        code = code.trim();
        return code;
    }

    // --- Main Conversation Orchestration ---
    async startConversation(conversationName: string, isNew: boolean): Promise<void> {
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

    // --- Private Helper Methods ---

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
            const interactionResult = await this.ui.getPromptViaSublimeLoop(
                conversationName,
                conversation.getMessages(),
                paths.editorFilePath // Pass editor path explicitly
            );

            // Editor file path might change if ui logic changes, update for cleanup
            // editorFilePathForCleanup = interactionResult.editorFilePath;

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

    /** Handles the '/consolidate' command. */
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

    /** Builds context and calls the AI for a standard user prompt. */
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

    /** Handles errors occurring during the main conversation loop. */
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

    /** Cleans up the temporary editor file. */
    private async _cleanupEditorFile(editorFilePath: string | null): Promise<void> {
        if (editorFilePath) {
            try {
                await this.fs.access(editorFilePath); // Check if it exists
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

    // --- Consolidation Orchestration Method ---
    // This method now uses the injected consolidationService which itself uses the injected gitService
    async processConsolidationRequest(conversationName: string): Promise<void> {
        const { conversationFilePath } = this._getConversationPaths(conversationName); // Use helper
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
            // The consolidationService instance already has the correct GitService instance injected
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