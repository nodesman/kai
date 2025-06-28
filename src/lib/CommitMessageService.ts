import { AIClient } from './AIClient';
import { GitService } from './GitService';
import { countTokens } from './utils';
import { Message } from './models/Conversation';

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

        const system = 'Generate a concise git commit message describing the following changes.';
        if (countTokens(combined) <= this.maxTokens) {
            const messages: Message[] = [
                { role: 'user', content: `${system}\n${combined}` }
            ];
            const response = await this.aiClient.getResponseTextFromAI(messages, true);
            return response.replace(/^commit:\s*/i, '').trim();
        }

        const chunks = this.chunkByTokens(combined, this.maxTokens - 500);
        let messages: Message[] = [ { role: 'user', content: system + ' I will provide diff chunks. Reply with "COMMIT:" followed by the message when ready or "CONTINUE" if you need more.' } ];
        let response = '';
        for (const chunk of chunks) {
            messages.push({ role: 'user', content: chunk });
            response = await this.aiClient.getResponseTextFromAI(messages, true);
            if (/^commit:/i.test(response.trim())) {
                return response.replace(/^commit:\s*/i, '').trim();
            }
            messages.push({ role: 'assistant', content: response });
        }
        return response.trim();
    }
}
