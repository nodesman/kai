import { AIClient } from './AIClient';
import { GitService } from './GitService';
import { countTokens } from './utils';
import { Message } from './models/Conversation';
import chalk from 'chalk';

export class CommitMessageService {
    constructor(
        private aiClient: AIClient,
        private git: GitService,
        private maxTokens: number
    ) {}

    private chunkByTokens(text: string, limit: number): string[] {
        const lines = text.split('\n');
        const chunks: string[] = [];
        let current = '';
        for (const line of lines) {
            const prospective = current ? current + '\n' + line : line;
            if (countTokens(prospective) > limit) {
                if (current) chunks.push(current);
                current = line;
            } else {
                current = prospective;
            }
        }
        if (current) chunks.push(current);
        return chunks;
    }

    async generateCommitMessage(projectRoot: string): Promise<string> {
        const diff = await this.git.getDiff(projectRoot);
        const files = await this.git.listModifiedFiles(projectRoot);
        const combined = `Changed files:\n${files.join('\n')}\n\n${diff}`;

        const system = 'Generate a single, concise git commit message describing the following changes. Provide only one final message and do not offer multiple options.';
        const totalTokens = countTokens(combined);
        if (totalTokens <= this.maxTokens) {
            console.log(chalk.dim(`CommitMessage: diff within limit (${totalTokens}/${this.maxTokens} tokens).`));
            const messages: Message[] = [
                { role: 'user', content: `${system}\n${combined}` }
            ];
            const response = await this.aiClient.getResponseTextFromAI(messages, true);
            return response.replace(/^commit:\s*/i, '').trim();
        }

        const chunks = this.chunkByTokens(combined, this.maxTokens - 500);
        console.log(chalk.dim(`CommitMessage: batching diff into ${chunks.length} chunk(s).`));
        let messages: Message[] = [ { role: 'user', content: system + ' I will provide diff chunks. Reply with "COMMIT:" followed by the single best message when ready or "CONTINUE" if you need more.' } ];
        let response = '';
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(chalk.dim(`  -> Sending diff chunk ${i + 1}/${chunks.length} (~${countTokens(chunk)} tokens)`));
            messages.push({ role: 'user', content: chunk });
            response = await this.aiClient.getResponseTextFromAI(messages, true);
            if (/^commit:/i.test(response.trim())) {
                return response.replace(/^commit:\s*/i, '').trim();
            }
            messages.push({ role: 'assistant', content: response });
        }
        console.log(chalk.dim(`CommitMessage: completed ${chunks.length} diff chunk(s).`));
        return response.trim();
    }
}
