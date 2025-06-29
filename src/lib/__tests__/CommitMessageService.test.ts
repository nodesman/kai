import { CommitMessageService } from '../CommitMessageService';

const dummyAI = () => ({ getResponseTextFromAI: jest.fn() });
const dummyGit = (diff: string, files: string[]) => ({
    getDiff: jest.fn().mockResolvedValue(diff),
    listModifiedFiles: jest.fn().mockResolvedValue(files)
});

describe('CommitMessageService', () => {
    test('uses single request when diff fits within maxTokens', async () => {
        const ai = dummyAI();
        (ai.getResponseTextFromAI as jest.Mock).mockResolvedValue('COMMIT: msg');
        const git = dummyGit('diff', ['a.ts']);
        const service = new CommitMessageService(ai as any, git as any, 100);
        const msg = await service.generateCommitMessage('/p');
        expect(msg).toBe('msg');
        expect(ai.getResponseTextFromAI).toHaveBeenCalledTimes(1);
        const call = (ai.getResponseTextFromAI as jest.Mock).mock.calls[0][0];
        expect(call[0].content).toMatch('a.ts');
        expect(call[0].content).toMatch('diff');
        expect(call[0].content).toMatch(/single, concise git commit message/i);
    });

    test('chunks diff when it exceeds maxTokens', async () => {
        const ai = dummyAI();
        (ai.getResponseTextFromAI as jest.Mock)
            .mockResolvedValueOnce('CONTINUE')
            .mockResolvedValueOnce('COMMIT: msg');
        const largeDiff = 'line1\nline2\nline3\nline4\nline5';
        const git = dummyGit(largeDiff, ['b.ts']);
        // small token limit to force chunking
        const service = new CommitMessageService(ai as any, git as any, 5);
        const msg = await service.generateCommitMessage('/p');
        expect(msg).toBe('msg');
        expect(ai.getResponseTextFromAI as jest.Mock).toHaveBeenCalledTimes(2);
        const firstCall = (ai.getResponseTextFromAI as jest.Mock).mock.calls[0][0];
        expect(firstCall[0].content).toMatch(/single, concise git commit message/i);
    });
});
