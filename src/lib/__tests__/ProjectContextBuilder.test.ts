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
