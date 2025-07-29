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
import { TypeScriptLoop } from './consolidation/feedback/TypeScriptLoop';
import { CommitMessageService } from './CommitMessageService';
import { TestCoverageRaiser } from './hardening/TestCoverageRaiser';

const CONSOLIDATION_SUCCESS_MARKER = "[System: Consolidation Completed Successfully]";

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
    commitMessageService: CommitMessageService;
    hardenService: TestCoverageRaiser;

    static async create(
        config: Config,
        fs: FileSystem,
        commandService: CommandService,
        gitService: GitService,
        ui: UserInterface,
        contextBuilder: ProjectContextBuilder
    ): Promise<CodeProcessor> {
        const projectRoot = await gitService.getRepositoryRoot(process.cwd());
        return new CodeProcessor(
            config,
            fs,
            commandService,
            gitService,
            ui,
            contextBuilder,
            projectRoot
        );
    }

    // --- MODIFIED Constructor ---
    private constructor(
        config: Config,
        fs: FileSystem,
        commandService: CommandService,
        gitService: GitService,
        ui: UserInterface,
        contextBuilder: ProjectContextBuilder,
        projectRoot: string
    ) {
        this.config = config;
        this.fs = fs;
        this.commandService = commandService;
        this.gitService = gitService;
        this.ui = ui; // <-- Assign injected instance
        this.contextBuilder = contextBuilder; // <-- Assign injected instance
        this.aiClient = new AIClient(config); // AIClient only needs config (and fs internally)
        this.projectRoot = projectRoot;

        this.commitMessageService = new CommitMessageService(
            this.aiClient,
            this.gitService,
            this.config.gemini.max_prompt_tokens
        );

        const feedbackLoops = [
            new TypeScriptLoop(this.commandService, this.fs, this.config)
        ];

        // Pass injected services to ConsolidationService
        this.consolidationService = new ConsolidationService(
            this.config,
            this.fs,
            this.aiClient,
            this.projectRoot,
            this.gitService,
            this.ui,
            this.commitMessageService,
            feedbackLoops
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

        this.hardenService = new TestCoverageRaiser(
            this.config,
            this.fs,
            this.commandService,
            this.aiClient,
            this.projectRoot
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

            let currentContextString: string;
            if (this.config.context.mode === 'dynamic') {
                const historySlice = this._findRelevantHistorySlice(conversation);
                const historySummary = this._summarizeHistory(historySlice);
                const ctx = await this.contextBuilder.buildDynamicContext(
                    'Consolidate recent conversation changes',
                    historySummary
                );
                currentContextString = ctx.context;
            } else {
                const { context } = await this.contextBuilder.buildContext();
                currentContextString = context;
            }

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

    async processHardeningRequest(tool: string): Promise<void> {
        await this.hardenService.process(tool);
    }

    async generateKaiignore(): Promise<void> {
        console.log(chalk.cyan('\nGenerating .kaiignore using AI suggestions...'));
        let fileList: string[] = [];
        try {
            const { stdout } = await this.commandService.run('find . -type f', { cwd: this.projectRoot });
            fileList = stdout.split('\n')
                .map(l => l.trim())
                .filter(l => l && l !== '.' && !l.startsWith('./.git/') && !l.startsWith('./.kai/'))
                .map(p => p.replace(/^\.\/?/, '').replace(/\\/g, '/'))
                .sort();
        } catch (err) {
            console.error(chalk.red('Failed to list project files:'), err);
            return;
        }

        const listForPrompt = fileList.map(f => `- ${f}`).join('\n');
        const prompt = `Here is the list of files in my project:\n${listForPrompt}\n\nGenerate a recommended .kaiignore file to exclude unnecessary files from Kai's context. Respond ONLY with the file contents.`;
        const messages: Message[] = [ { role: 'user', content: prompt } ];
        let response: string;
        try {
            response = await this.aiClient.getResponseTextFromAI(messages, true);
        } catch (error) {
            console.error(chalk.red('AI generation failed:'), error);
            return;
        }

        const kaiignorePath = path.join(this.projectRoot, '.kaiignore');
        try {
            await this.fs.writeFile(kaiignorePath, response.trim() + '\n');
            console.log(chalk.green(`.kaiignore written to ${kaiignorePath}`));
        } catch (err) {
            console.error(chalk.red('Failed to write .kaiignore:'), err);
        }
    }

    /**
     * Updates the AI client across the processor and dependent services.
     */
    updateAIClient(aiClient: AIClient): void {
        this.aiClient = aiClient;
        this.conversationManager.updateAIClient(aiClient);
        this.consolidationService.updateAIClient(aiClient);
        this.hardenService.updateAIClient(aiClient);
    }

    /** Returns conversation messages since the last successful consolidation. */
    private _findRelevantHistorySlice(conversation: Conversation): Message[] {
        const allMessages = conversation.getMessages();
        let lastSuccessIndex = -1;
        for (let i = allMessages.length - 1; i >= 0; i--) {
            if (allMessages[i].role === 'system' && allMessages[i].content === CONSOLIDATION_SUCCESS_MARKER) {
                lastSuccessIndex = i;
                break;
            }
        }
        return allMessages.slice(lastSuccessIndex + 1);
    }

    /** Creates a simple summary of conversation history for dynamic context */
    private _summarizeHistory(history: Message[]): string | null {
        if (!history || history.length === 0) return null;
        const recentMessages = history.slice(-4);
        let summary = 'Recent conversation highlights:\n';
        recentMessages.forEach((msg: Message) => {
            const contentPreview = typeof msg.content === 'string'
                ? `${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`
                : '[Non-text content]';
            summary += `  ${msg.role}: ${contentPreview}\n`;
        });
        return summary;
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