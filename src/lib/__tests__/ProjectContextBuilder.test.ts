import path from 'path';
import { ProjectContextBuilder } from '../ProjectContextBuilder';
import { ProjectAnalysisCache } from '../analysis/types';

describe('ProjectContextBuilder.buildContext (analysis_cache mode)', () => {
  const fsMock = { readAnalysisCache: jest.fn() } as any;
  const gitMock = {} as any;
  const aiClient = {} as any;
  const config: any = {
    analysis: { cache_file_path: 'cache.json' },
    context: { mode: 'analysis_cache' },
    gemini: { max_prompt_tokens: 1000 },
    project: {}
  };
  let builder: ProjectContextBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new ProjectContextBuilder(fsMock, gitMock, '/root', config, aiClient);
  });

  it('formats cache when present', async () => {
    const cache: ProjectAnalysisCache = {
      overallSummary: 'overall',
      entries: [
        { filePath: 'a.ts', type: 'text_analyze', size: 10, loc: 1, summary: 'sum', lastAnalyzed: 'now' }
      ]
    };
    fsMock.readAnalysisCache.mockResolvedValue(cache);

    const res = await builder.buildContext();

    expect(fsMock.readAnalysisCache).toHaveBeenCalledWith(path.resolve('/root', 'cache.json'));
    expect(res.context).toContain('Project Analysis Overview');
    expect(res.context).toContain('a.ts');
    expect(typeof res.tokenCount).toBe('number');
  });

  it('throws when cache missing', async () => {
    fsMock.readAnalysisCache.mockResolvedValue(null);
    await expect(builder.buildContext()).rejects.toThrow(/Analysis cache/);
  });
});

describe('ProjectContextBuilder utilities', () => {
  const fsMock = { readAnalysisCache: jest.fn() } as any;
  const gitMock = {} as any;
  const aiClient = { getResponseTextFromAI: jest.fn() } as any;
  const config: any = {
    analysis: { cache_file_path: 'cache.json' },
    context: { mode: 'dynamic' },
    gemini: { max_prompt_tokens: 1000 },
    project: {}
  };
  let builder: ProjectContextBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new ProjectContextBuilder(fsMock, gitMock, '/root', config, aiClient);
  });

  it('requires user query in dynamic mode', async () => {
    await expect(builder.buildContext()).rejects.toThrow(/User query is required/);
  });

  it('formats cache for relevance', () => {
    const cache: ProjectAnalysisCache = {
      overallSummary: '',
      entries: [
        { filePath: 'a.ts', type: 'text_analyze', size: 2048, loc: 10, summary: 'details', lastAnalyzed: 'now' }
      ]
    };
    const summary = (builder as any)._formatCacheForRelevance(cache);
    expect(summary).toContain('a.ts [text analyze]');
    expect(summary).toContain('Summary: details');
  });

  it('optimizes whitespace', () => {
    const res = (builder as any).optimizeWhitespace('a \n\n\n b  ');
    expect(res).toBe('a\n\n b');
  });
});
