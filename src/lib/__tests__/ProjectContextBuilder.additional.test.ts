import path from 'path';
import { ProjectContextBuilder } from '../ProjectContextBuilder';
import { ProjectAnalysisCache } from '../analysis/types';
import { countTokens } from '../utils';

describe('ProjectContextBuilder extra coverage', () => {
  const silence = () => {};
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(silence);
    jest.spyOn(console, 'warn').mockImplementation(silence);
    jest.spyOn(console, 'error').mockImplementation(silence);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('build() delegates to buildContext', async () => {
    const fsMock: any = {};
    const gitMock: any = {};
    const ai: any = {};
    const builder = new ProjectContextBuilder(fsMock, gitMock, '/r', { context:{ mode:'full' }, analysis:{}, gemini:{}, project:{} } as any, ai);
    const spy = jest.spyOn(builder, 'buildContext').mockResolvedValue({ context: 'c', tokenCount: 1 });
    const res = await builder.build();
    expect(spy).toHaveBeenCalled();
    expect(res).toEqual({ context: 'c', tokenCount: 1 });
  });

  test('estimateFullContextTokens ignores empty files', async () => {
    const fsMock: any = {
      getProjectFiles: jest.fn().mockResolvedValue(['/r/a.ts','/r/empty.ts']),
      readFile: jest.fn((p: string) => Promise.resolve(p.includes('a.ts') ? 'code' : '   '))
    };
    const gitMock: any = { getIgnoreRules: jest.fn().mockResolvedValue({ ignores: () => false }) };
    const builder = new ProjectContextBuilder(fsMock, gitMock, '/r', { context:{ mode:'full' }, analysis:{}, gemini:{}, project:{} } as any, {} as any);
    const tokens = await builder.estimateFullContextTokens();
    const expected = countTokens('Code Base Context:\n') + countTokens('\n---\nFile: a.ts\n```\ncode\n```\n');
    expect(tokens).toBe(expected);
  });

  test('_formatCacheAsContext details', () => {
    const builder = new ProjectContextBuilder({} as any, {} as any, '/r', { context:{}, analysis:{}, gemini:{}, project:{} } as any, {} as any);
    const cache: ProjectAnalysisCache = {
      overallSummary: 'summary',
      entries: [
        { filePath: 'a.ts', type: 'text_analyze', size: 1024, loc: 10, summary: 'ok', lastAnalyzed: 'n' },
        { filePath: 'b.bin', type: 'binary', size: 2048, loc: null, summary: null, lastAnalyzed: 'n' }
      ]
    };
    const res = (builder as any)._formatCacheAsContext(cache);
    expect(res.context).toContain('summary');
    expect(res.context).toContain('File: a.ts');
    expect(res.context).toContain('(LOC: 10)');
    expect(res.context).toContain('Summary: ok');
    expect(res.context).toContain('File: b.bin');
    expect(res.context).toContain('[binary] (Size: 2.0 KB)');
    expect(res.context).toContain('Summary: (Not summarized)');
  });

  test('dynamic context falls back when base prompt too large', async () => {
    const cache: ProjectAnalysisCache = { overallSummary: 'o', entries: [] };
    const fsMock: any = { readAnalysisCache: jest.fn().mockResolvedValue(cache) };
    const aiClient: any = { getResponseTextFromAI: jest.fn() };
    const builder = new ProjectContextBuilder(fsMock, {} as any, '/r', {
      analysis:{ cache_file_path:'c.json' },
      context:{ mode:'dynamic' },
      gemini:{ max_prompt_tokens: 501 },
      project:{}
    } as any, aiClient);
    const res = await builder.buildContext('q','h');
    expect(res.context).toContain('Project analysis cache is missing or empty');
    expect(aiClient.getResponseTextFromAI).not.toHaveBeenCalled();
  });

  test('dynamic context skips invalid and oversized files', async () => {
    const cache: ProjectAnalysisCache = { overallSummary: 'o', entries: [{ filePath: 'a.ts', type: 'text_analyze', size: 10, loc: 1, summary: 'sum', lastAnalyzed: 'n' }] };
    const fsMock: any = {
      readAnalysisCache: jest.fn().mockResolvedValue(cache),
      readFile: jest.fn((p: string) => Promise.resolve(p.endsWith('a.ts') ? 'x '.repeat(600) : null))
    };
    const aiClient: any = { getResponseTextFromAI: jest.fn().mockResolvedValue('../secret\nNONE\nmissing.ts\na.ts') };
    const builder = new ProjectContextBuilder(fsMock, {} as any, '/r', {
      analysis:{ cache_file_path:'c.json' },
      context:{ mode:'dynamic' },
      gemini:{ max_prompt_tokens: 552 },
      project:{}
    } as any, aiClient);
    const res = await builder.buildContext('q','h');
    expect(fsMock.readFile).toHaveBeenCalledWith('/r/a.ts');
    expect(res.context).not.toContain('File: a.ts');
    const base = 'User Query: q\nHistory Summary: h\n--- Relevant File Context ---\n';
    expect(res.tokenCount).toBe(countTokens(base));
  });
});

  test('analysis cache empty branch', async () => {
    const fsMock: any = { readAnalysisCache: jest.fn().mockResolvedValue({ overallSummary: 's', entries: [] }) };
    const builder = new ProjectContextBuilder(fsMock, {} as any, '/r', {
      analysis:{ cache_file_path:'c.json' },
      context:{ mode:'analysis_cache' },
      gemini:{},
      project:{}
    } as any, {} as any);
    const res = await builder.buildContext();
    expect(res.context).toContain('Project Analysis Cache is empty');
  });

  test('_buildFullContext skips whitespace files', async () => {
    const fsMock: any = {
      getProjectFiles: jest.fn().mockResolvedValue(['/r/a.ts','/r/b.ts']),
      readFileContents: jest.fn().mockResolvedValue({ '/r/a.ts': 'code', '/r/b.ts': '  \n\n' })
    };
    const gitMock: any = { getIgnoreRules: jest.fn().mockResolvedValue({ ignores: () => false }) };
    const builder = new ProjectContextBuilder(fsMock, gitMock, '/r', { context:{}, analysis:{}, gemini:{}, project:{} } as any, {} as any);
    const res = await (builder as any)._buildFullContext();
    expect(res.context).toContain('File: a.ts');
    expect(res.context).not.toContain('b.ts');
  });

  test('dynamic context no selections', async () => {
    const cache: ProjectAnalysisCache = { overallSummary: 'o', entries: [{ filePath: 'a.ts', type: 'text_analyze', size: 10, loc: 1, summary: 'sum', lastAnalyzed: 'n' }] };
    const fsMock: any = { readAnalysisCache: jest.fn().mockResolvedValue(cache), readFile: jest.fn() };
    const aiClient: any = { getResponseTextFromAI: jest.fn().mockResolvedValue('NONE') };
    const builder = new ProjectContextBuilder(fsMock, {} as any, '/r', {
      analysis:{ cache_file_path:'c.json' },
      context:{ mode:'dynamic' },
      gemini:{ max_prompt_tokens: 520 },
      project:{}
    } as any, aiClient);
    const res = await builder.buildContext('q','h');
    expect(res.context).toContain('Project Analysis Overview');
  });
