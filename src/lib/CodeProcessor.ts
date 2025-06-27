// lib/CodeProcessor.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient';
import { Config } from "./Config";
import { UserInterface } from './UserInterface'; // <-- ADDED Import
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { ProjectContextBuilder } from './ProjectContextBuilder'; // <-- ADDED Import
import { ConsolidationService } from './consolidation/ConsolidationService';
import { CommandService } from './CommandService';
import { GitService } from './GitService';
import { ConversationManager } from './ConversationManager'; // <-- ADDED Import
import { toSnakeCase } from './utils'; // <-- Added for path generation duplication

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    ui: UserInterface; // <-- ADDED Property
    projectRoot: string;
    contextBuilder: ProjectContextBuilder; // <-- ADDED Property
    consolidationService: ConsolidationService;
    commandService: CommandService;
    gitService: GitService;
    conversationManager: ConversationManager; // <-- ADDED Property

    // --- MODIFIED Constructor ---
    constructor(
        config: Config,
        fs: FileSystem,
        commandService: CommandService,
        gitService: GitService,
        ui: UserInterface,                // <-- ADDED Parameter
        contextBuilder: ProjectContextBuilder // <-- ADDED Parameter
    ) {
        this.config = config;
        this.fs = fs;
        this.commandService = commandService;
        this.gitService = gitService;
        this.ui = ui; // <-- Assign injected instance
        this.contextBuilder = contextBuilder; // <-- Assign injected instance
        this.aiClient = new AIClient(config); // AIClient only needs config (and fs internally)
        this.projectRoot = process.cwd(); // projectRoot derived here

        // Pass injected services to ConsolidationService
        this.consolidationService = new ConsolidationService(
            this.config,
            this.fs,
            this.aiClient,
            this.projectRoot,
            this.gitService
        );

        // --- Instantiate ConversationManager with required dependencies ---
        this.conversationManager = new ConversationManager(
            this.config,
            this.fs,
            this.aiClient,
            this.ui, // Pass injected UI
            this.contextBuilder, // Pass injected ContextBuilder
            this.consolidationService // Pass the created ConsolidationService
        );
    }
    // --- END MODIFIED Constructor ---

    // --- REMOVED Methods (moved to ConversationManager) ---
    // _getConversationPaths (logic duplicated below if needed)
    // _loadOrCreateConversation
    // _handleUserInputLoop
    // _processLoopIteration
    // _handleConsolidateCommand (the one inside the loop)
    // _callAIWithContext
    // _handleConversationError
    // _cleanupEditorFile
    // --- END REMOVED Methods ---

    /**
     * Starts a new or continues an existing conversation session.
     * Delegates the actual session management to ConversationManager.
     * @param conversationName The user-facing name of the conversation.
     * @param isNew Whether this is a newly created conversation.
     */
    async startConversation(conversationName: string, isNew: boolean): Promise<void> {
        // Delegate directly to the ConversationManager instance
        await this.conversationManager.runSession(conversationName, isNew);
    }

    /**
     * Orchestrates the consolidation process when triggered directly (not via /consolidate command).
     * Uses the ConsolidationService.
     * @param conversationName The name of the conversation to consolidate.
     */
    async processConsolidationRequest(conversationName: string): Promise<void> {
        // Duplicate path generation logic needed for loading the conversation file
        const snakeName = toSnakeCase(conversationName);
        const conversationFileName = `${snakeName}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        // End duplicate path generation

        let conversation: Conversation;

        try {
            // Load conversation data using injected fs
            const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
            conversation = Conversation.fromJsonlData(logData);
            if (conversation.getMessages().length === 0) {
                console.warn(chalk.yellow("Conversation is empty, cannot consolidate."));
                return;
            }

            // Build context string using the injected contextBuilder
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
            console.error(chalk.red(`\n❌ Error triggering consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation setup: ${(error as Error).message}. See console for details.`;
            try {
                const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg };
                await this.aiClient.logConversation(conversationFilePath, logPayload); // Use internal aiClient
            } catch (logErr) { console.error(chalk.red("Additionally failed to log consolidation setup error:"), logErr); }
        }
    }

    /**
     * Updates the AI client across the processor and dependent services.
     */
    updateAIClient(aiClient: AIClient): void {
        this.aiClient = aiClient;
        this.conversationManager.updateAIClient(aiClient);
        this.consolidationService.updateAIClient(aiClient);
    }

     // Keep optimizeWhitespace if it's potentially used by other methods or could be useful
     // If not, it can be removed as well. Currently not used within this class.
     optimizeWhitespace(code: string): string {
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\r\n/g, '\n');
        code = code.replace(/\n{3,}/g, '\n\n');
        code = code.trim();
        return code;
    }
}

export { CodeProcessor };