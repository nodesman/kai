// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
import { AIClient, LogEntryData } from './AIClient';
import { Config } from "./Config";
import { UserInterface } from './UserInterface';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { toSnakeCase, countTokens } from './utils';
import chalk from 'chalk';
import { ProjectContextBuilder } from './ProjectContextBuilder';
import { ConsolidationService } from './ConsolidationService';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
const exec = promisify(execCb); // Promisify for async/await usage


class CodeProcessor {
    config: Config; // Use the Config class instance type
    fs: FileSystem;
    aiClient: AIClient;
    ui: UserInterface;
    projectRoot: string;
    private readonly CONSOLIDATE_COMMAND = '/consolidate';
    private contextBuilder: ProjectContextBuilder;
    private consolidationService: ConsolidationService;

    constructor(config: Config) { // Accept Config class instance
        this.config = config;
        this.fs = new FileSystem();
        // AIClient constructor now handles creating both model instances
        this.aiClient = new AIClient(config);
        this.ui = new UserInterface(config);
        this.projectRoot = process.cwd();
        this.contextBuilder = new ProjectContextBuilder(this.fs, this.projectRoot, this.config); // Add this line
        // Instantiate ConsolidationService here, passing dependencies
        this.consolidationService = new ConsolidationService(this.config, this.fs, this.aiClient, this.projectRoot);
    }

    // --- buildContextString (Keep as is, used by both Conversation and ConsolidationService via CodeProcessor) ---
    async buildContextString(): Promise<{ context: string, tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context...'));
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const fileContents = await this.fs.readFileContents(filePaths);

        let contextString = "Code Base Context:\n";
        let currentTokenCount = countTokens(contextString);
        const maxContextTokens = (this.config.gemini.max_prompt_tokens || 32000) * 0.6; // 60% safety margin
        let includedFiles = 0;
        let excludedFiles = 0;
        const sortedFilePaths = Object.keys(fileContents).sort();
        let estimatedTotalTokens = currentTokenCount;

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) {
                console.log(chalk.gray(`  Skipping empty file: ${relativePath}`));
                excludedFiles++;
                continue;
            }
            content = this.optimizeWhitespace(content);
            if (!content) {
                console.log(chalk.gray(`  Skipping file with only whitespace: ${relativePath}`));
                excludedFiles++;
                continue;
            }

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n\`\`\`\n";
            const fileBlock = fileHeader + content + fileFooter;
            const fileTokens = countTokens(fileBlock);

            contextString += fileBlock;
            estimatedTotalTokens += fileTokens;
            includedFiles++;
            console.log(chalk.dim(`  Included ${relativePath} (${fileTokens} tokens). Current total: ${estimatedTotalTokens.toFixed(0)}`));
        }
        console.log(chalk.blue(`Context built with ${includedFiles} files (${estimatedTotalTokens.toFixed(0)} tokens estimated). ${excludedFiles} files excluded/skipped. Max context set to ${maxContextTokens.toFixed(0)} tokens.`));
        const finalTokenCount = countTokens(contextString);
        console.log(chalk.blue(`Final calculated context token count: ${finalTokenCount}`));

        // Add warning if context exceeds the overall max prompt token limit
        if (finalTokenCount > (this.config.gemini.max_prompt_tokens || 32000)) {
            console.warn(chalk.yellow(`Warning: Final context token count (${finalTokenCount}) exceeds configured max_prompt_tokens (${this.config.gemini.max_prompt_tokens}). Potential truncation by API.`));
        }

        return { context: contextString, tokenCount: finalTokenCount };
    }

    optimizeWhitespace(code: string): string {
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\r\n/g, '\n');
        code = code.replace(/\n{3,}/g, '\n\n');
        code = code.trim();
        return code;
    }
    // --- End context building ---

    // --- startConversation (MODIFIED) ---
    async startConversation(conversationName: string, isNew: boolean): Promise<void> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        let editorFilePath: string | null = null;
        let conversation: Conversation;

        try {
            if (!isNew) {
                const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
                conversation = Conversation.fromJsonlData(logData);
                console.log(`Loaded ${conversation.getMessages().length} messages for ${conversationName}.`);
            } else {
                conversation = new Conversation();
                console.log(`Starting new conversation: ${conversationName}`);
            }

            while (true) {
                const interactionResult = await this.ui.getPromptViaSublimeLoop(conversationName, conversation.getMessages());
                editorFilePath = interactionResult.editorFilePath;
                if (interactionResult.newPrompt === null) break;
                const userPrompt = interactionResult.newPrompt;

                // Handle /consolidate command trigger (unchanged)
                if (userPrompt.trim().toLowerCase() === this.CONSOLIDATE_COMMAND) {
                    console.log(chalk.yellow(`🚀 Intercepted ${this.CONSOLIDATE_COMMAND}. Starting consolidation process...`));
                    conversation.addMessage('user', userPrompt);
                    try { await this.aiClient.logConversation(conversationFilePath, { type: 'request', role: 'user', content: userPrompt }); } catch (logErr) { console.error(chalk.red("Error logging consolidate command:"), logErr); }

                    // Call the consolidation service. Context string built here.
                    console.log(chalk.cyan("  Fetching fresh codebase context for consolidation..."));
                    // Use buildContextString directly (it's still part of CodeProcessor)
                    const { context: currentContextString } = await this.buildContextString();
                    await this.consolidationService.process(conversationName, conversation, currentContextString, conversationFilePath);

                    conversation.addMessage('system', `[Consolidation process triggered for '${conversationName}' has finished. See logs.]`);
                    continue; // Skip normal AI call
                }

                // Add user message (unchanged)
                conversation.addMessage('user', userPrompt);

                try {
                    // Use the ProjectContextBuilder instance
                    const { context: currentContextString } = await this.contextBuilder.build();

                    await this.aiClient.getResponseFromAI(
                        conversation,
                        conversationFilePath,
                        currentContextString,
                        false //useFlash // REMOVE isFirstRequestInLoop
                    );

                } catch (aiError) {
                    console.error(chalk.red("Error during AI interaction:"), aiError);
                    conversation.addMessage('system', `[Error occurred during AI request: ${(aiError as Error).message}. Please check logs. You can try again or exit.]`);
                }
            }
            console.log(`\nExiting conversation "${conversationName}".`);
        } catch (error) { // Catch block unchanged
            console.error(chalk.red(`\nAn unexpected error occurred in conversation "${conversationName}":`), error);
            if (conversationFilePath) {
                try { await this.aiClient.logConversation(conversationFilePath, { type: 'error', error: `CodeProcessor loop error: ${(error as Error).message}` }); } catch (logErr) { console.error(chalk.red("Additionally failed to log CodeProcessor error:"), logErr); }
            }
        } finally { // Finally block unchanged
            if (editorFilePath) {
                try {
                    await this.fs.access(editorFilePath);
                    await this.fs.deleteFile(editorFilePath);
                    console.log(`Cleaned up editor file: ${editorFilePath}`);
                } catch (cleanupError) {
                    if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                        console.warn(chalk.yellow(`\nWarning: Failed to clean up editor file ${editorFilePath}:`), cleanupError);
                    }
                }
            }
        }
    }

    // --- Consolidation Orchestration Method ---
    async processConsolidationRequest(conversationName: string): Promise<void> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        let conversation: Conversation;

        try {
            // Load conversation data
            const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
            conversation = Conversation.fromJsonlData(logData);
            if (conversation.getMessages().length === 0) {
                console.warn(chalk.yellow("Conversation is empty, cannot consolidate."));
                return;
            }

            // Build context string (as ConsolidationService expects it)
            console.log(chalk.cyan("Fetching fresh codebase context for consolidation..."));
            // Use buildContextString directly
            const { context: currentContextString } = await this.buildContextString();

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