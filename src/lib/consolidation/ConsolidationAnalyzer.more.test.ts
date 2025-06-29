import { ConsolidationAnalyzer } from './ConsolidationAnalyzer';
import { AIClient } from '../AIClient';
import { Message } from '../models/Conversation';

jest.mock('../AIClient');

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

describe('ConsolidationAnalyzer detailed', () => {
  let analyzer: ConsolidationAnalyzer;
  let ai: jest.Mocked<AIClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    ai = new AIClient({} as any) as jest.Mocked<AIClient>;
    analyzer = new ConsolidationAnalyzer(ai);
  });

  test('parseAndAdaptAnalysisResponse handles fenced JSON array', () => {
    const raw = '```json\n[{"file_path":"src/a.ts","action":"CREATE"}]\n```';
    const result = (analyzer as any)._parseAndAdaptAnalysisResponse(raw, 'm');
    expect(result).toEqual({ operations: [{ file_path: 'src/a.ts', action: 'CREATE' }] });
  });

  test('parseAndAdaptAnalysisResponse extracts JSON from surrounding text', () => {
    const raw = 'text {"operations":[{"filePath":"x.ts","action":"DELETE"}]} more';
    const result = (analyzer as any)._parseAndAdaptAnalysisResponse(raw, 'm');
    expect(result).toEqual({ operations: [{ filePath: 'x.ts', action: 'DELETE' }] });
  });

  test('parseAndAdaptAnalysisResponse throws on invalid JSON', () => {
    expect(() => (analyzer as any)._parseAndAdaptAnalysisResponse('oops', 'm')).toThrow(/Failed to parse JSON analysis/);
  });

  test('validateAndNormalizeOperations filters and normalizes', () => {
    const ops = [
      { filePath: 'src/new.ts', action: 'CREATE' },
      { file_path: '/foo/bar/../b.ts/', action: 'MODIFY' },
      { filePath: 'bad', action: 'INVALID' },
      null,
      { filePath: '', action: 'DELETE' },
      {} as any,
    ];
    const result = (analyzer as any)._validateAndNormalizeOperations(ops);
    expect(result).toEqual([
      { filePath: 'src/new.ts', action: 'CREATE' },
      { filePath: 'foo/b.ts', action: 'MODIFY' },
    ]);
  });

  test('analyze logs and rethrows parse errors', async () => {
    ai.getResponseTextFromAI.mockResolvedValueOnce('not json');
    ai.logConversation.mockResolvedValueOnce();
    const messages: Message[] = [{ role: 'user', content: 'hi' }];
    await expect(analyzer.analyze(messages, 'ctx', '/c', false, 'model')).rejects.toThrow('Failed to analyze conversation using model');
    expect(ai.logConversation).toHaveBeenCalled();
  });

  test('logError handles logging failures gracefully', async () => {
    ai.logConversation.mockRejectedValueOnce(new Error('fail'));
    await (analyzer as any)._logError('/c', 'msg');
    expect(ai.logConversation).toHaveBeenCalledWith('/c', { type: 'error', role: 'system', error: 'msg' });
  });

  test('setAIClient replaces instance', () => {
    const newAi = new AIClient({} as any) as jest.Mocked<AIClient>;
    analyzer.setAIClient(newAi);
    expect((analyzer as any).aiClient).toBe(newAi);
  });

  test('parseAndAdaptAnalysisResponse throws for missing operations', () => {
    expect(() => (analyzer as any)._parseAndAdaptAnalysisResponse('{"foo":1}', 'm')).toThrow(/Invalid JSON structure/);
  });

  test('parseAndAdaptAnalysisResponse throws for non array operations', () => {
    expect(() => (analyzer as any)._parseAndAdaptAnalysisResponse('{"operations":{}}', 'm')).toThrow(/Failed to parse JSON analysis/);
  });

  test('validateAndNormalizeOperations handles non array', () => {
    const result = (analyzer as any)._validateAndNormalizeOperations({} as any);
    expect(result).toEqual([]);
  });

  test('validateAndNormalizeOperations skips empty normalized path', () => {
    const result = (analyzer as any)._validateAndNormalizeOperations([{ filePath: '/', action: 'CREATE' }]);
    expect(result).toEqual([]);
  });

  test('analyze logs raw response snippet when long empty operations', async () => {
    const longResp = JSON.stringify({ operations: [] }) + ' '.repeat(60);
    ai.getResponseTextFromAI.mockResolvedValueOnce(longResp);
    const res = await analyzer.analyze([], 'ctx', '/c', false, 'model');
    expect(res).toEqual({ operations: [] });
  });

  test('parseAndAdaptAnalysisResponse matches fenced snippet', () => {
    expect(() => (analyzer as any)._parseAndAdaptAnalysisResponse('```x```', 'm')).toThrow(/Failed to parse JSON analysis/);
  });

  test('parseAndAdaptAnalysisResponse fallback substring logic', () => {
    const input = 'prefix [ {"a":1}';
    expect(() => (analyzer as any)._parseAndAdaptAnalysisResponse(input, 'm')).toThrow(/Failed to parse JSON analysis/);
  });
});
