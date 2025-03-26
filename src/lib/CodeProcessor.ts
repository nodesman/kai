// lib/CodeProcessor.ts
import path from 'path';
import { FileSystem } from './FileSystem';
// Use correct type import from AIClient
import { AIClient, LogEntryData } from './AIClient';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { Config } from "./Config";
import { UserInterface } from './UserInterface';
import Conversation, { Message, JsonlLogEntry } from './models/Conversation';
import { toSnakeCase } from './utils';
import FullScreenUI from "./iterativeDiff/FullScreenUI"; // Keep for TUI mode
import chalk from 'chalk';
import * as Diff from 'diff'; // Import the diff library
import inquirer from 'inquirer'; // Import inquirer for the placeholder

// --- Import for Git Check ---
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
const exec = promisify(execCb); // Promisify for async/await usage
// --- End Import ---

// Import the Review UI Manager
import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager';


// --- Interfaces for Consolidation ---
interface ConsolidationAnalysis {
    operations: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE' }>;
    groups: string[][];
}

interface FinalFileStates {
    [filePath: string]: string | 'DELETE_CONFIRMED';
}
// --- End Consolidation Interfaces ---

class CodeProcessor {
    config: Config;
    fs: FileSystem;
    aiClient: AIClient;
    ui: UserInterface;
    projectRoot: string;
    private readonly CONSOLIDATE_COMMAND = '/consolidate';

    constructor(config: Config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(config);
        this.ui = new UserInterface(config);
        this.projectRoot = process.cwd();
    }

    countTokens(text: string): number {
        return gpt3Encode(text).length;
    }

    // --- buildContextString ---
    async buildContextString(): Promise<{ context: string, tokenCount: number }> {
        console.log(chalk.blue('\nBuilding project context...'));
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const fileContents = await this.fs.readFileContents(filePaths);

        let contextString = "Code Base Context:\n";
        let currentTokenCount = this.countTokens(contextString);
        const maxContextTokens = (this.config.gemini.max_prompt_tokens || 32000) * 0.6;
        let includedFiles = 0;
        let excludedFiles = 0;
        const sortedFilePaths = Object.keys(fileContents).sort();
        let estimatedTokens = currentTokenCount;

        for (const filePath of sortedFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];
            if (!content) { excludedFiles++; continue; }
            content = this.optimizeWhitespace(content);
            if (!content) { excludedFiles++; continue; }

            const fileHeader = `\n---\nFile: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileBlock = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileBlock);

            if (estimatedTokens + fileTokens > maxContextTokens) {
                console.warn(chalk.yellow(`Skipping file due to token limit: ${relativePath} (${fileTokens} tokens)`));
                excludedFiles++;
                continue;
            }
            contextString += fileBlock;
            estimatedTokens += fileTokens;
            includedFiles++;
        }
        console.log(chalk.blue(`Context built with ${estimatedTokens} tokens from ${includedFiles} files (${excludedFiles} files excluded/skipped). Max set to ${maxContextTokens}.`));
        return { context: contextString, tokenCount: estimatedTokens };
    }

    optimizeWhitespace(code: string): string {
        code = code.replace(/[ \t]+$/gm, '');
        code = code.replace(/\r\n/g, '\n');
        code = code.replace(/\n{3,}/g, '\n\n');
        code = code.trim();
        return code;
    }
    // --- End context building ---

    // --- startConversation ---
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

                if (userPrompt.trim().toLowerCase() === this.CONSOLIDATE_COMMAND) {
                    console.log(chalk.yellow(`🚀 Intercepted ${this.CONSOLIDATE_COMMAND}. Starting consolidation process...`));
                    conversation.addMessage('user', userPrompt);
                    try { await this.aiClient.logConversation(conversationFilePath, { type: 'request', role: 'user', content: userPrompt }); }
                    catch (logErr) { console.error(chalk.red("Error logging consolidate command:"), logErr); }
                    await this.processConsolidationRequest(conversationName);
                    conversation.addMessage('system', `[Consolidation process triggered for '${conversationName}' has finished. See logs.]`);
                    continue;
                }

                conversation.addMessage('user', userPrompt);
                try {
                    const { context: currentContextString } = await this.buildContextString();
                    await this.aiClient.getResponseFromAI(conversation, conversationFilePath, currentContextString);
                } catch (aiError) {
                    console.error(chalk.red("Error during AI interaction:"), aiError);
                    conversation.addMessage('system', `[Error occurred during AI request: ${(aiError as Error).message}. Please check logs. You can try again or exit.]`);
                }
            }
            console.log(`\nExiting conversation "${conversationName}".`);
        } catch (error) {
            console.error(chalk.red(`\nAn unexpected error occurred in conversation "${conversationName}":`), error);
            if (conversationFilePath) {
                try { await this.aiClient.logConversation(conversationFilePath, { type: 'error', error: `CodeProcessor loop error: ${(error as Error).message}` }); }
                catch (logErr) { console.error(chalk.red("Additionally failed to log CodeProcessor error:"), logErr); }
            }
        } finally {
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
        const startMsg = `System: Starting AI-driven code consolidation for '${conversationName}'...`;
        console.log(chalk.blue(startMsg.replace('System: ', '')));

        try {
            const logData = await this.fs.readJsonlFile(conversationFilePath) as JsonlLogEntry[];
            conversation = Conversation.fromJsonlData(logData);
            if (conversation.getMessages().length === 0) { console.warn(chalk.yellow("Conversation is empty.")); return; }
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: startMsg });

            console.log(chalk.cyan("  Fetching fresh codebase context..."));
            const { context: currentContextString } = await this.buildContextString();

            console.log(chalk.cyan("  Step A: Analyzing conversation..."));
            const analysisResult = await this.analyzeConversationForChanges(conversation, currentContextString);
            if (!analysisResult || analysisResult.operations.length === 0) {
                const msg = "System: Analysis complete. No specific file operations identified.";
                console.log(chalk.yellow(msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg }); return;
            }
            const analysisSummary = `System: Analysis found ${analysisResult.operations.length} ops (${analysisResult.operations.filter(op => op.action === 'CREATE').length}C/${analysisResult.operations.filter(op => op.action === 'MODIFY').length}M/${analysisResult.operations.filter(op => op.action === 'DELETE').length}D) in ${analysisResult.groups.length} groups.`;
            console.log(chalk.cyan(analysisSummary.replace('System: ', '')));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: analysisSummary });

            console.log(chalk.cyan("  Step B: Generating final file states..."));
            const finalStates = await this.generateFinalFileContents(conversation, currentContextString, analysisResult);
            const genSummary = `System: Generated final states for ${Object.keys(finalStates).length} files/actions.`;
            console.log(chalk.cyan(genSummary.replace('System: ', '')));
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: genSummary });

            console.log(chalk.cyan("  Step C: Preparing changes for review..."));
            const reviewData = await this.prepareReviewData(finalStates);
            if (reviewData.length === 0) {
                const msg = "System: No effective changes detected after generation.";
                console.log(chalk.green(msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg }); return;
            }

            const reviewUI = new ReviewUIManager(reviewData);
            const applyChanges = await reviewUI.run();

            if (applyChanges) {
                console.log(chalk.cyan("  Step D: Applying approved changes..."));
                await this.applyConsolidatedChanges(finalStates, conversationFilePath);
                // applyConsolidatedChanges logs its own summary
            } else {
                const msg = `System: Consolidation aborted by user. No changes applied.`;
                console.log(chalk.yellow(msg.replace('System: ', '')));
                await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: msg });
            }
        } catch (error) {
            console.error(chalk.red(`\n❌ Error during consolidation process for '${conversationName}':`), error);
            const errorMsg = `System: Error during consolidation: ${(error as Error).message}. See console for details.`;
            try {
                // --- *** CORRECTED ERROR LOGGING HERE *** ---
                const logPayload: LogEntryData = { type: 'error', role: 'system', error: errorMsg }; // Use 'error' property
                await this.aiClient.logConversation(conversationFilePath, logPayload);
                // --- *** END CORRECTION *** ---
            } catch (logErr) {
                console.error(chalk.red("Additionally failed to log consolidation error:"), logErr);
            }
        }
    }

    // --- Step A Implementation ---
    private async analyzeConversationForChanges(
        conversation: Conversation,
        codeContext: string
    ): Promise<ConsolidationAnalysis | null> {
        const analysisPrompt = `CONTEXT:\nYou are an expert AI analyzing a software development conversation...\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map(m => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nBased *only* on the conversation history and the provided codebase context, determine the final intended operations (CREATE, MODIFY, DELETE) for each relevant file path (relative to the project root). Resolve contradictions based on conversational flow (later messages override earlier ones unless stated otherwise).\n\nAlso, group the files needing CREATE or MODIFY into logical sets for generating their final content. Aim to minimize subsequent requests. Files marked for DELETE do not need grouping.\n\nOUTPUT FORMAT:\nRespond *only* with a single JSON object matching this structure:\n\`\`\`json\n{\n  "operations": [\n    { "filePath": "path/relative/to/root.ext", "action": "CREATE" | "MODIFY" | "DELETE" }\n  ],\n  "groups": [\n    ["path/to/file1.ext", "path/to/file2.ext"],\n    ["path/to/another_file.ext"]\n  ]\n}\n\`\`\`\nIf no operations are intended, return \`{ "operations": [], "groups": [] }\`. Ensure filePaths are relative.`;
        try {
            const responseText = await this.aiClient.getResponseTextFromAI([{ role: 'user', content: analysisPrompt }]);
            const jsonString = responseText.trim().replace(/^```json\s*/, '').replace(/```$/, '');
            const jsonResponse = JSON.parse(jsonString);
            if (jsonResponse && Array.isArray(jsonResponse.operations) && Array.isArray(jsonResponse.groups)) {
                jsonResponse.operations.forEach((op: any) => { if (op.filePath) op.filePath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, ''); });
                jsonResponse.groups.forEach((group: string[]) => { for (let i = 0; i < group.length; i++) group[i] = path.normalize(group[i]).replace(/^[\\\/]+|[\\\/]+$/g, ''); });
                return jsonResponse as ConsolidationAnalysis;
            } else { throw new Error("Invalid JSON structure from analysis AI."); }
        } catch (e) { throw new Error(`AI analysis step failed. Error: ${(e as Error).message}`); }
    }

    // --- Step B Implementation ---
    private async generateFinalFileContents(
        conversation: Conversation,
        codeContext: string,
        analysisResult: ConsolidationAnalysis
    ): Promise<FinalFileStates> {
        const allFinalStates: FinalFileStates = {};
        const groups = analysisResult.groups;
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            if (!group || group.length === 0) continue;
            console.log(chalk.cyan(`    Generating content for group ${i + 1}/${groups.length}: [${group.join(', ')}]`));
            const generationPrompt = `CONTEXT:\nYou are an expert AI generating the final state of source code files...\n\nCODEBASE CONTEXT:\n${codeContext}\n\n---\nCONVERSATION HISTORY:\n${conversation.getMessages().map(m => `${m.role}:\n${m.content}\n---\n`).join('')}\n---\nTASK:\nGenerate the *entire, final file content* for:\n${group.map(f => `- ${f}`).join('\n')}\n\nOUTPUT FORMAT:\nRespond *only* with a single JSON object where keys are relative file paths and values are strings containing the *complete final content*.\n\`\`\`json\n{\n  "path/file1.ext": "CONTENT...",\n  "path/file2.ext": "CONTENT..."\n}\n\`\`\`\nOmit files that should not exist.`;
            try {
                const responseText = await this.aiClient.getResponseTextFromAI([{ role: 'user', content: generationPrompt }]);
                const jsonString = responseText.trim().replace(/^```json\s*/, '').replace(/```$/, '');
                const jsonResponse = JSON.parse(jsonString);
                for (const key in jsonResponse) {
                    const normalizedKey = path.normalize(key).replace(/^[\\\/]+|[\\\/]+$/g, '');
                    allFinalStates[normalizedKey] = jsonResponse[key];
                }
            } catch (e) { throw new Error(`AI generation failed for group ${i + 1}. Error: ${(e as Error).message}`); }
        }
        const deleteOps = analysisResult.operations.filter(op => op.action === 'DELETE');
        for (const op of deleteOps) {
            const normalizedPath = path.normalize(op.filePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
            if (!(normalizedPath in allFinalStates)) allFinalStates[normalizedPath] = 'DELETE_CONFIRMED';
            else console.warn(chalk.yellow(`Note: ${normalizedPath} marked DELETE but also had content generated. Prioritizing generation.`));
        }
        return allFinalStates;
    }

    // --- Step C - Prepare Data ---
    private async prepareReviewData(finalStates: FinalFileStates): Promise<ReviewDataItem[]> {
        const reviewData: ReviewDataItem[] = [];
        for (const relativePath in finalStates) {
            const proposed = finalStates[relativePath];
            const absolutePath = path.resolve(this.projectRoot, relativePath);
            let current: string | null = null;
            let action: ReviewAction = 'MODIFY';
            try { current = await this.fs.readFile(absolutePath); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            let diffStr = '';
            if (proposed === 'DELETE_CONFIRMED') {
                action = 'DELETE';
                if (current !== null) diffStr = Diff.createPatch(relativePath, current, '', '', '', { context: 5 });
                else continue;
            } else if (current === null) {
                action = 'CREATE';
                diffStr = Diff.createPatch(relativePath, '', proposed, '', '', { context: 5 });
            } else {
                action = 'MODIFY';
                diffStr = Diff.createPatch(relativePath, current, proposed, '', '', { context: 5 });
            }
            const isMeaningful = diffStr.split('\n').slice(2).some(l => l.startsWith('+') || l.startsWith('-'));
            if (action === 'CREATE' || action === 'DELETE' || isMeaningful) reviewData.push({ filePath: relativePath, action, diff: diffStr });
            else console.log(chalk.gray(`  Skipping review for ${relativePath} - no effective changes.`));
        }
        return reviewData;
    }

    // --- Step C - TUI/Review ---
    private async presentChangesForReviewTUI(reviewData: ReviewDataItem[]): Promise<boolean> {
        console.log(chalk.yellow("\nInitializing Review UI..."));
        try {
            const reviewUI = new ReviewUIManager(reviewData);
            return await reviewUI.run();
        } catch (tuiError) {
            console.error(chalk.red("Error displaying Review TUI:"), tuiError);
            console.log(chalk.yellow("Falling back to simple CLI confirmation."));
            const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Review UI failed. Apply ${reviewData.length} changes based on console summary?`, default: false }]);
            return confirm;
        }
    }

    // --- Step D Implementation (Apply Changes with Git Check) ---
    private async applyConsolidatedChanges(finalStates: FinalFileStates, conversationFilePath: string): Promise<void> {
        console.log(chalk.blue("Checking Git status..."));
        try {
            const { stdout, stderr } = await exec('git status --porcelain', { cwd: this.projectRoot });
            if (stderr) console.warn(chalk.yellow("Git status stderr:"), stderr);
            const status = stdout.trim();
            if (status !== '') {
                console.error(chalk.red("\nError: Git working directory not clean:"));
                console.error(chalk.red(status));
                throw new Error('Git working directory not clean. Aborted.');
            } else console.log(chalk.green("Git status clean. Proceeding..."));
        } catch (error: any) {
            console.error(chalk.red("\nError checking Git status:"), error.message || error);
            if (error.message?.includes('command not found') || error.code === 'ENOENT') throw new Error('Git command not found.');
            else if (error.stderr?.includes('not a git repository')) throw new Error('Project directory is not a Git repository.');
            throw new Error(`Failed to verify Git status. Error: ${error.message}`);
        }

        let success = 0, failed = 0, skipped = 0;
        const summary: string[] = [];
        for (const relativePath in finalStates) {
            const absolutePath = path.resolve(this.projectRoot, relativePath);
            const contentOrAction = finalStates[relativePath];
            try {
                if (contentOrAction === 'DELETE_CONFIRMED') {
                    try {
                        await this.fs.access(absolutePath);
                        await this.fs.deleteFile(absolutePath);
                        console.log(chalk.red(`  Deleted: ${relativePath}`));
                        summary.push(`Deleted: ${relativePath}`); success++;
                    } catch (accessError) {
                        if ((accessError as NodeJS.ErrnoException).code === 'ENOENT') {
                            console.warn(chalk.yellow(`  Skipped delete (already gone): ${relativePath}`));
                            summary.push(`Skipped delete (already gone): ${relativePath}`); skipped++;
                        } else throw accessError;
                    }
                } else {
                    await this.fs.ensureDirExists(path.dirname(absolutePath));
                    await this.fs.writeFile(absolutePath, contentOrAction);
                    console.log(chalk.green(`  Written: ${relativePath}`));
                    summary.push(`Written: ${relativePath}`); success++;
                }
            } catch (error) {
                console.error(chalk.red(`  Failed apply for ${relativePath}:`), error);
                summary.push(`Failed ${contentOrAction === 'DELETE_CONFIRMED' ? 'delete' : 'write'}: ${relativePath} - ${(error as Error).message}`);
                failed++;
            }
        }

        console.log(chalk.blue("\n--- Consolidation Apply Summary ---"));
        summary.forEach(l => console.log(l.startsWith("Failed") ? chalk.red(`- ${l}`) : l.startsWith("Skipped") ? chalk.yellow(`- ${l}`) : chalk.green(`- ${l}`)));
        console.log(chalk.blue(`---------------------------------`));
        console.log(chalk.blue(`Applied: ${success}, Skipped/No-op: ${skipped}, Failed: ${failed}.`));
        try {
            const title = failed > 0 ? 'Consolidation Summary (with failures)' : 'Consolidation Summary';
            await this.aiClient.logConversation(conversationFilePath, { type: 'system', role: 'system', content: `${title}:\n${summary.join('\n')}` });
        } catch (logErr) { console.warn(chalk.yellow("Warning: Could not log apply summary."), logErr); }
        // if (failed > 0) { throw new Error(`Consolidation completed with ${failed} failure(s).`); }
    }

    // --- TUI Mode ---
    async startCodeChangeTUI(): Promise<void> {
        console.log("Initializing Code Change TUI...");
        const fullScreenUI = new FullScreenUI(); // Assuming FullScreenUI exists
        fullScreenUI.show();
        return new Promise(() => {});
    }
}

export { CodeProcessor };