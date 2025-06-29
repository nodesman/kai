import { ConsolidationGenerator } from '../ConsolidationGenerator';
import { FileSystem } from '../../FileSystem';
import { AIClient } from '../../AIClient';
import { ConsolidationPrompts } from '../prompts';

jest.mock('../prompts');
jest.mock('../../AIClient');

// suppress console output for tests
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

const config: any = { gemini: { generation_max_retries: 1, generation_retry_base_delay_ms: 0 } };
let fsMock: jest.Mocked<FileSystem>;
let aiMock: jest.Mocked<AIClient>;
let generator: ConsolidationGenerator;

beforeEach(() => {
  fsMock = { readFile: jest.fn() } as unknown as jest.Mocked<FileSystem>;
  aiMock = new AIClient(config) as jest.Mocked<AIClient>;
  jest.clearAllMocks();
  generator = new ConsolidationGenerator(config, fsMock, aiMock, '/root');
});

it('setAIClient updates the client', () => {
  const newClient = {} as any;
  generator.setAIClient(newClient);
  expect((generator as any).aiClient).toBe(newClient);
});

describe('_parseGenerationAIResponse', () => {
  it('handles DELETE_FILE response', async () => {
    aiMock.logConversation.mockResolvedValue(undefined);
    const res = await (generator as any)._parseGenerationAIResponse('DELETE_FILE', 'file.txt', 'conv');
    expect(res).toBe('DELETE_CONFIRMED');
    expect(aiMock.logConversation).toHaveBeenCalledWith('conv', { type: 'system', role: 'system', content: 'System: AI suggested DELETE for file.txt during individual generation.' });
  });

  it('strips fences when complete', () => {
    const res = (generator as any)._parseGenerationAIResponse('```ts\nfoo\n```', 'a.ts', 'conv');
    expect(res).toBe('foo');
    expect(console.warn).toHaveBeenCalled();
  });

  it('keeps text with partial fence', () => {
    const res = (generator as any)._parseGenerationAIResponse('```js\nfoo', 'b.ts', 'conv');
    expect(res).toBe('```js\nfoo');
  });
});

describe('_readCurrentFileContent', () => {
  it('returns file content when file exists', async () => {
    fsMock.readFile.mockResolvedValue('data');
    await expect((generator as any)._readCurrentFileContent('a.txt')).resolves.toBe('data');
  });

  it('returns null for missing file', async () => {
    fsMock.readFile.mockRejectedValue({ code: 'ENOENT' });
    await expect((generator as any)._readCurrentFileContent('a.txt')).resolves.toBeNull();
  });

  it('rethrows unexpected error', async () => {
    const err = { code: 'EOTHER' };
    fsMock.readFile.mockRejectedValue(err);
    await expect((generator as any)._readCurrentFileContent('a.txt')).rejects.toBe(err);
  });
});

describe('_callGenerationAIWithRetry', () => {
  let randSpy: jest.SpyInstance<number, []>;
  beforeEach(() => {
    randSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    randSpy.mockRestore();
  });

  it('retries on rate limit error then succeeds', async () => {
    aiMock.getResponseTextFromAI
      .mockRejectedValueOnce({ message: 'rate limit', code: 'RATE_LIMIT' })
      .mockResolvedValue('ok');
    await expect((generator as any)._callGenerationAIWithRetry('p', 'file', false)).resolves.toBe('ok');
    expect(aiMock.getResponseTextFromAI).toHaveBeenCalledTimes(2);
  });

  it('throws non-retryable error', async () => {
    const err = new Error('boom');
    aiMock.getResponseTextFromAI.mockRejectedValue(err);
    await expect((generator as any)._callGenerationAIWithRetry('p', 'file', false)).rejects.toBe(err);
  });
});

describe('_generateContentForFile', () => {
  beforeEach(() => {
    (ConsolidationPrompts.individualFileGenerationPrompt as jest.Mock).mockReturnValue('prompt');
    jest.spyOn(generator as any, '_readCurrentFileContent').mockResolvedValue(null);
  });

  it('stores delete confirmation when AI returns DELETE_FILE', async () => {
    const states: any = {};
    jest.spyOn(generator as any, '_callGenerationAIWithRetry').mockResolvedValue('DELETE_FILE');
    const logSpy = jest.spyOn(generator as any, '_logSystemMessage').mockResolvedValue(undefined);
    await (generator as any)._generateContentForFile('dir/file.txt', states, 'ctx', 'hist', false, 'model', 'conv');
    expect(states['dir/file.txt']).toBe('DELETE_CONFIRMED');
    expect(logSpy).toHaveBeenCalledWith('conv', 'System: AI suggested DELETE for dir/file.txt during individual generation.');
  });

  it('stores cleaned content for normal response', async () => {
    const states: any = {};
    jest.spyOn(generator as any, '_callGenerationAIWithRetry').mockResolvedValue('```ts\ncontent\n```');
    await (generator as any)._generateContentForFile('a/../b.ts', states, 'ctx', 'hist', false, 'model', 'conv');
    expect(states['b.ts']).toBe('content');
  });

  it('logs errors when generation fails', async () => {
    const states: any = {};
    jest.spyOn(generator as any, '_callGenerationAIWithRetry').mockRejectedValue(new Error('fail'));
    const errSpy = jest.spyOn(generator as any, '_logError').mockResolvedValue(undefined);
    await (generator as any)._generateContentForFile('f.ts', states, 'ctx', 'hist', false, 'model', 'conv');
    expect(errSpy).toHaveBeenCalled();
    expect(states).toEqual({});
  });
});

describe('_applyAnalysisDeletes', () => {
  it('marks deletes and overrides generated content', async () => {
    const states: any = { 'a.txt': 'keep' };
    const analysis = { operations: [ { filePath: 'b.txt', action: 'DELETE' }, { filePath: 'a.txt', action: 'DELETE' } ] } as any;
    aiMock.logConversation.mockResolvedValue(undefined);
    await (generator as any)._applyAnalysisDeletes(states, analysis, 'conv');
    expect(states).toEqual({ 'a.txt': 'DELETE_CONFIRMED', 'b.txt': 'DELETE_CONFIRMED' });
    expect(aiMock.logConversation).toHaveBeenCalledWith('conv', { type: 'system', role: 'system', content: 'System: Overriding generated content for a.txt with DELETE based on analysis.' });
  });
});

describe('_logError and _logSystemMessage', () => {
  it('logs errors and system messages', async () => {
    aiMock.logConversation.mockResolvedValue(undefined);
    await (generator as any)._logError('conv', 'err');
    await (generator as any)._logSystemMessage('conv', 'msg');
    expect(aiMock.logConversation).toHaveBeenNthCalledWith(1, 'conv', { type: 'error', role: 'system', error: 'err' });
    expect(aiMock.logConversation).toHaveBeenNthCalledWith(2, 'conv', { type: 'system', role: 'system', content: 'msg' });
  });

  it('handles failures to log', async () => {
    aiMock.logConversation.mockRejectedValue(new Error('fail'));
    await (generator as any)._logError('conv', 'err');
    await (generator as any)._logSystemMessage('conv', 'msg');
    expect(aiMock.logConversation).toHaveBeenCalledTimes(2);
  });
});


describe('generate integration', () => {
  it('builds history and calls _generateContentForFile', async () => {
    const messages = [ { role: 'user', content: 'hi' } as any ];
    const analysis = { operations: [ { filePath: 'a.txt', action: 'CREATE' } ] } as any;
    const genSpy = jest.spyOn(generator as any, '_generateContentForFile').mockResolvedValue(undefined);
    jest.spyOn(generator as any, '_applyAnalysisDeletes').mockResolvedValue(undefined);
    await generator.generate(messages, 'ctx', analysis, 'conv', false, 'model');
    expect(genSpy).toHaveBeenCalledWith('a.txt', {}, 'ctx', 'user:\nhi\n---\n', false, 'model', 'conv');
  });

  it('skips generation when no files to create or modify', async () => {
    const analysis = { operations: [ { filePath: 'a.txt', action: 'DELETE' } ] } as any;
    const genSpy = jest.spyOn(generator as any, '_generateContentForFile');
    jest.spyOn(generator as any, '_applyAnalysisDeletes').mockResolvedValue(undefined);
    const res = await generator.generate([], 'ctx', analysis, 'conv', false, 'model');
    expect(genSpy).not.toHaveBeenCalled();
    expect(res).toEqual({});
  });
});

