import { TestCoverageRaiser } from '../TestCoverageRaiser';
import { FileSystem } from '../../FileSystem';
import { CommandService } from '../../CommandService';
import { AIClient } from '../../AIClient';
import * as diff from 'diff';
import path from 'path';

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

    it('gracefully handles unsupported tool', async () => {
        const fs = { readFile: jest.fn(), writeFile: jest.fn() } as unknown as FileSystem;
        const cmd = { run: jest.fn() } as unknown as CommandService;
        const ai = { getResponseTextFromAI: jest.fn() } as unknown as AIClient;
        const raiser = new TestCoverageRaiser({ project: {} } as any, fs, cmd, ai, '/p');
        await raiser.process('mocha');
        expect(cmd.run).not.toHaveBeenCalled();
    });

    it('derives test path correctly', () => {
        const raiser = new TestCoverageRaiser({} as any, new FileSystem(), new CommandService(), {} as any, '/p');
        const res = (raiser as any)._deriveTestPath('/p/src/a.ts');
        expect(res).toBe('/p/src/a.test.ts');
    });

    it('reads coverage summary safely', async () => {
        const readFileMock = jest.fn().mockResolvedValue('{"a":1}');
        const fs = { readFile: readFileMock } as unknown as FileSystem;
        const raiser = new TestCoverageRaiser({} as any, fs, new CommandService(), {} as any, '/p');
        const result = await (raiser as any)._readCoverageSummary('/f');
        expect(result).toEqual({ a: 1 });

        readFileMock.mockResolvedValue('bad');
        const bad = await (raiser as any)._readCoverageSummary('/f');
        expect(bad).toBeNull();

        readFileMock.mockResolvedValue(null);
        const none = await (raiser as any)._readCoverageSummary('/f');
        expect(none).toBeNull();
    });

    it('finds lowest coverage file for various path formats', () => {
        const raiser = new TestCoverageRaiser({} as any, new FileSystem(), new CommandService(), {} as any, '/root');
        const find = (raiser as any)._findLowestCoverageFile.bind(raiser);

        // Absolute path case
        const abs = find({ '/root/a.ts': { lines: { pct: 50 } }, total: {} });
        expect(abs).toBe(path.normalize('/root/a.ts'));

        // Weird relative containing project root components
        const weirdPath = path.join('root', 'a.ts');
        const weird = find({ [weirdPath]: { lines: { pct: 40 } }, total: {} });
        expect(weird).toBe(path.join('/root', 'a.ts'));

        // Standard relative path
        const rel = find({ 'b.ts': { lines: { pct: 30 } }, total: {} });
        expect(rel).toBe(path.join('/root', 'b.ts'));

        // No file entries
        expect(find({ total: {} })).toBeNull();
    });

    it('logs diff failure and stops iteration', async () => {
        const config: any = { project: { coverage_iterations: 2 } };
        let summaryCall = 0;
        const fs = {
            readFile: jest.fn(async (p: string) => {
                if (p === '/p/coverage/coverage-summary.json') {
                    summaryCall++;
                    if (summaryCall === 1) return JSON.stringify({ '/p/a.ts': { lines: { pct: 80 } }, total: {} });
                    if (summaryCall === 2) return JSON.stringify({ '/p/a.ts': { lines: { pct: 90 } }, total: {} });
                    return null; // force summary null on next loop
                }
                if (p === '/p/a.test.ts') return 'content';
                if (p === '/p/a.ts') return 'src';
                return null;
            }),
            writeFile: jest.fn(),
            applyDiffToFile: jest.fn().mockResolvedValue(false),
            lastDiffFailure: { file: '/p/a.test.ts', diff: 'd', fileContent: 'c', error: 'e' }
        } as unknown as FileSystem & { lastDiffFailure: any };
        const cmd = { run: jest.fn().mockResolvedValue({}) } as unknown as CommandService;
        const ai = { getResponseTextFromAI: jest.fn().mockResolvedValue('diff') } as unknown as AIClient;
        const fsModule = await import('../../FileSystem');
        const logSpy = jest.spyOn(fsModule, 'logDiffFailure').mockResolvedValue();
        const raiser = new TestCoverageRaiser(config, fs, cmd, ai, '/p');
        await raiser.process('jest');
        expect(fs.applyDiffToFile).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalled();
    });

    it('updates AI client instance', async () => {
        const config = { project: { coverage_iterations: 1 } } as any;
        const fs = {
            readFile: jest.fn().mockResolvedValue('{"/p/a.ts":{"lines":{"pct":80}},"total":{}}'),
            writeFile: jest.fn(),
            applyDiffToFile: jest.fn().mockResolvedValue(true)
        } as unknown as FileSystem;
        const cmd = { run: jest.fn().mockResolvedValue({}) } as unknown as CommandService;
        const ai1 = { getResponseTextFromAI: jest.fn().mockResolvedValue('') } as unknown as AIClient;
        const raiser = new TestCoverageRaiser(config, fs, cmd, ai1, '/p');
        const ai2 = { getResponseTextFromAI: jest.fn().mockResolvedValue('') } as unknown as AIClient;
        raiser.updateAIClient(ai2);
        await raiser.process('jest');
        expect(ai1.getResponseTextFromAI).not.toHaveBeenCalled();
        expect(ai2.getResponseTextFromAI).toHaveBeenCalled();
    });

    it('runs coverage and handles command errors', async () => {
        const cmd = { run: jest.fn().mockRejectedValue(new Error('fail')) } as unknown as CommandService;
        const raiser = new TestCoverageRaiser({} as any, new FileSystem(), cmd, {} as any, '/p');
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        await (raiser as any)._runJestCoverage();
        expect(cmd.run).toHaveBeenCalled();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('exits early when coverage summary missing or files fully covered', async () => {
        const readFileMock = jest.fn().mockResolvedValue(null);
        const fs = { readFile: readFileMock } as unknown as FileSystem;
        const cmd = { run: jest.fn().mockResolvedValue({}) } as unknown as CommandService;
        const raiser = new TestCoverageRaiser({ project: {} } as any, fs, cmd, {} as any, '/p');
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        await raiser.process('jest');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Coverage summary not found.'));

        readFileMock.mockResolvedValue('{"total":{}}');
        await raiser.process('jest');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('All files fully covered.'));
        logSpy.mockRestore();
    });
});
