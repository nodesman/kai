import { TestCoverageRaiser } from '../TestCoverageRaiser';
import { FileSystem } from '../../FileSystem';
import { CommandService } from '../../CommandService';
import { AIClient } from '../../AIClient';
import * as diff from 'diff';

describe('TestCoverageRaiser', () => {
    it('creates instance', () => {
        const raiser = new TestCoverageRaiser({} as any, new FileSystem(), new CommandService(), {} as any, '/project');
        expect(raiser).toBeDefined();
    });

    it('improves coverage iteratively', async () => {
        const config: any = { project: { coverage_iterations: 2 } };
        let testContent: string | null = null;
        let coverageReadCount = 0;
        const summaries = [
            { '/project/src/a.ts': { lines: { pct: 80 } }, total: {} },
            { '/project/src/a.ts': { lines: { pct: 100 } }, total: {} }
        ];

        const fsMock = {
            readFile: jest.fn(async (p: string) => {
                if (p === '/project/coverage/coverage-summary.json') {
                    return JSON.stringify(summaries[coverageReadCount++]);
                }
                if (p === '/project/src/a.test.ts') return testContent;
                if (p === '/project/src/a.ts') return 'src';
                return null;
            }),
            writeFile: jest.fn(async (p: string, c: string) => {
                if (p === '/project/src/a.test.ts') testContent = c;
            }),
            applyDiffToFile: jest.fn(async () => {
                testContent = 'patched';
                return true;
            })
        } as unknown as FileSystem;

        const cmd = { run: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }) } as any as CommandService;

        const patch = diff.createTwoFilesPatch('a.test.ts', 'a.test.ts', 'describe(\'a\', () => {});', 'describe(\'a\', () => {test(\'x\', () => {});});');
        const ai = { getResponseTextFromAI: jest.fn().mockResolvedValue(patch) } as any as AIClient;

        const raiser = new TestCoverageRaiser(config, fsMock, cmd, ai, '/project');
        await raiser.process('jest');

        expect(fsMock.writeFile).toHaveBeenCalledWith('/project/src/a.test.ts', expect.any(String));
        expect(fsMock.applyDiffToFile).toHaveBeenCalledWith('/project/src/a.test.ts', patch);
        expect(ai.getResponseTextFromAI).toHaveBeenCalled();
    });
});
