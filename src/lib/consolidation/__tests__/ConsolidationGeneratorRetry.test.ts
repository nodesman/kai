import { ConsolidationGenerator } from '../ConsolidationGenerator';
import { FileSystem } from '../../FileSystem';

const fsMock = new FileSystem() as jest.Mocked<FileSystem>;

describe('ConsolidationGenerator retry logic', () => {
    it('retries when AI returns empty content', async () => {
        const config: any = { gemini: { generation_max_retries: 2, generation_retry_base_delay_ms: 1 } };
        const aiClient = { getResponseTextFromAI: jest.fn() } as any;
        const generator = new ConsolidationGenerator(config, fsMock, aiClient, '/project');

        jest.spyOn(generator as any, '_readCurrentFileContent').mockResolvedValue(null);
        const callSpy = jest
            .spyOn(generator as any, '_callGenerationAIWithRetry')
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('content');

        const result = await generator.generate(
            [],
            '',
            { operations: [{ filePath: 'a.txt', action: 'CREATE' }] },
            'log.jsonl',
            false,
            'Pro'
        );

        expect(callSpy).toHaveBeenCalledTimes(3);
        expect(result['a.txt']).toBe('content');
    });
});
