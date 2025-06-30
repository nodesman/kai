import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import chalk from 'chalk';
import { FileSystem } from '../FileSystem';
import { toSnakeCase } from '../utils';
import { Config } from '../Config';
import { Message } from '../models/Conversation';

export const HISTORY_SEPARATOR = '--- TYPE YOUR PROMPT ABOVE THIS LINE ---';

export interface PromptResult {
    newPrompt: string | null;
    conversationFilePath: string;
    editorFilePath: string;
}

export class PromptEditor {
    private fs: FileSystem;
    private config: Config;

    constructor(fs: FileSystem, config: Config) {
        this.fs = fs;
        this.config = config;
    }

    formatHistoryForSublime(messages: Message[]): string {
        let historyBlock = '';
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const timestampStr = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'Unknown Time';
            const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'LLM' : 'System';
            historyBlock += `${roleLabel}: [${timestampStr}]\n\n`;
            historyBlock += `${msg.content.trim()}\n\n`;
        }
        if (historyBlock) {
            return `\n\n${HISTORY_SEPARATOR}\n\n${historyBlock.trimEnd()}`;
        } else {
            return `${HISTORY_SEPARATOR}\n\n`;
        }
    }

    extractNewPrompt(fullContent: string): string | null {
        const separatorIndex = fullContent.indexOf(HISTORY_SEPARATOR);
        let promptRaw: string;
        if (separatorIndex !== -1) {
            promptRaw = fullContent.substring(0, separatorIndex);
        } else {
            console.warn(chalk.yellow('Warning: History separator not found in editor file. Treating entire content as prompt.'));
            promptRaw = fullContent;
        }
        const promptTrimmed = promptRaw.trim();
        return promptTrimmed ? promptTrimmed : null;
    }

    async getPromptViaSublimeLoop(
        conversationName: string,
        currentMessages: Message[],
        editorFilePath: string,
        isFallbackAttempt = false
    ): Promise<PromptResult> {
        const conversationFileName = `${toSnakeCase(conversationName)}.jsonl`;
        const conversationFilePath = path.join(this.config.chatsDir, conversationFileName);
        const contentToWrite = this.formatHistoryForSublime(currentMessages || []);
        const initialHash = crypto.createHash('sha256').update(contentToWrite).digest('hex');
        try {
            await this.fs.writeFile(editorFilePath, contentToWrite);
        } catch (writeError) {
            console.error(`Error writing temporary edit file ${editorFilePath}:`, writeError);
            throw writeError;
        }

        let editorCommand = 'subl';
        let editorArgs = ['-w', editorFilePath];
        let editorName = 'Sublime Text';
        if (process.platform === 'darwin' && !isFallbackAttempt) {
            const bundleId = process.env.__CFBundleIdentifier;
            if (bundleId === 'com.jetbrains.WebStorm') {
                editorCommand = 'webstorm';
                editorArgs = ['--wait', editorFilePath];
                editorName = 'WebStorm';
                console.log(chalk.blue(`Detected running inside WebStorm (macOS). Using '${editorCommand}' command...`));
            } else if (bundleId === 'com.jetbrains.CLion') {
                editorCommand = 'clion';
                editorArgs = ['--wait', editorFilePath];
                editorName = 'CLion';
                console.log(chalk.blue(`Detected running inside CLion (macOS). Using '${editorCommand}' command...`));
            } else if (bundleId === 'com.jetbrains.intellij') {
                editorCommand = 'idea';
                editorArgs = ['--wait', editorFilePath];
                editorName = 'IntelliJ IDEA';
                console.log(chalk.blue(`Detected running inside IntelliJ IDEA (macOS). Using '${editorCommand}' command...`));
            }
        }

        console.log(`\nOpening conversation "${conversationName}" in ${editorName}...`);
        console.log(`(Type your prompt above the '${HISTORY_SEPARATOR}', save, and close the editor tab/window to send)`);
        console.log(`(Close without saving OR save without changes to exit conversation)`);

        let exitCode: number | null = null;
        let processError: any = null;
        try {
            const editorProcess = spawn(editorCommand, editorArgs, { stdio: 'inherit' });
            exitCode = await new Promise<number | null>((resolve, reject) => {
                editorProcess.on('close', code => resolve(code));
                editorProcess.on('error', error => {
                    if ((error as any).code === 'ENOENT') {
                        const errorMsg = `❌ Error: '${editorCommand}' command not found.`;
                        const isJetBrainsLauncher = ['webstorm', 'clion', 'idea'].includes(editorCommand);
                        if (isJetBrainsLauncher && !isFallbackAttempt) {
                            console.error(chalk.red(`\n${errorMsg} Ensure the JetBrains IDE command-line launcher ('${editorCommand}') is created (Tools -> Create Command-line Launcher...) and its directory is in your system's PATH.`));
                            console.warn(chalk.yellow(`Falling back to 'subl'...`));
                            reject({ type: 'fallback', editor: 'subl', args: ['-w', editorFilePath] });
                        } else {
                            console.error(chalk.red(`\n${errorMsg} Make sure ${editorName} is installed and '${editorCommand}' is in your system's PATH.`));
                            reject(new Error(`'${editorCommand}' command not found.`));
                        }
                    } else {
                        console.error(chalk.red(`\n❌ Error spawning ${editorName}:`), error);
                        reject(error);
                    }
                });
            });
        } catch (err: any) {
            processError = err;
        }

        if (processError && processError.type === 'fallback') {
            console.log(chalk.blue(`Attempting to open with fallback editor: ${processError.editor}...`));
            return this.getPromptViaSublimeLoop(conversationName, currentMessages, editorFilePath, true);
        } else if (processError) {
            throw processError;
        }

        if (exitCode !== 0) {
            console.warn(chalk.yellow(`\n${editorName} process closed with non-zero code: ${exitCode}. Assuming exit.`));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        let modifiedContent: string;
        try {
            await fs.access(editorFilePath);
            modifiedContent = (await this.fs.readFile(editorFilePath)) || '';
        } catch (readError: any) {
            if (readError.code === 'ENOENT') {
                console.warn(chalk.yellow(`\nEditor file ${editorFilePath} not found after closing ${editorName}. Assuming exit.`));
                return { newPrompt: null, conversationFilePath, editorFilePath };
            }
            console.error(chalk.red(`\nError reading editor file ${editorFilePath} after closing:`), readError);
            throw readError;
        }

        const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');
        if (initialHash === modifiedHash) {
            console.log(chalk.blue(`\nNo changes detected in ${editorName}. Exiting conversation.`));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        const newPrompt = this.extractNewPrompt(modifiedContent);
        if (newPrompt === null) {
            console.log(chalk.blue(`\nNo new prompt entered. Exiting conversation.`));
            return { newPrompt: null, conversationFilePath, editorFilePath };
        }

        console.log(chalk.green(`\nPrompt received, processing with AI...`));
        return { newPrompt, conversationFilePath, editorFilePath };
    }
}

