import Conversation, { Message } from '../../models/Conversation';
import { ConsolidationService } from '../ConsolidationService';
import { CONSOLIDATION_SUCCESS_MARKER } from '../constants';
import { FileSystem } from '../../FileSystem';

// Silence console output during tests
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

const baseConfig:any = { gemini:{ model_name:'Pro', subsequent_chat_model_name:'Flash' }, project:{} };
const fs = new FileSystem();

function createService(){
  const ai:any = { logConversation: jest.fn() };
  const git:any = { checkCleanStatus: jest.fn() };
  const ui:any = { displayChangedFiles: jest.fn(), promptGenerateCommit: jest.fn(), confirmCommitMessage: jest.fn() };
  const commit:any = { generateCommitMessage: jest.fn() };
  return { ai, git, ui, commit, service: new ConsolidationService(baseConfig, fs, ai, '/p', git, ui, commit, []) };
}

describe('ConsolidationService internals', () => {
  test('updateAIClient propagates to analyzer and generator', () => {
    const { service } = createService();
    const gen = { setAIClient: jest.fn() };
    const analyzer = { setAIClient: jest.fn() };
    (service as any).consolidationGenerator = gen;
    (service as any).consolidationAnalyzer = analyzer;
    const newAI:any = {};
    (service as any).updateAIClient(newAI);
    expect((service as any).aiClient).toBe(newAI);
    expect(gen.setAIClient).toHaveBeenCalledWith(newAI);
    expect(analyzer.setAIClient).toHaveBeenCalledWith(newAI);
  });

  test('findRelevantHistorySlice returns messages after last marker', () => {
    const convo = new Conversation(undefined, [
      { role: 'user', content: 'a' },
      { role: 'system', content: CONSOLIDATION_SUCCESS_MARKER },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }
    ] as Message[]);
    const { service } = createService();
    const slice = (service as any)._findRelevantHistorySlice(convo);
    expect(slice.map((m: Message) => m.content)).toEqual(['b','c']);
  });

  test('process exits early when no history', async () => {
    const { service } = createService();
    const convo = new Conversation(undefined, [ { role: 'user', content: 'x' } ] as Message[]);
    (service as any)._performGitCheck = jest.fn().mockResolvedValue(undefined);
    (service as any)._findRelevantHistorySlice = jest.fn().mockReturnValue([]);
    (service as any)._logSystemMessage = jest.fn();

    await service.process('conv', convo, 'ctx', 'file');
    expect((service as any)._performGitCheck).toHaveBeenCalled();
    expect((service as any)._logSystemMessage).toHaveBeenCalledWith('file', expect.stringContaining('No new history'));
  });

  test('process happy path adds success marker', async () => {
    const { service, ai } = createService();
    const convo = new Conversation(undefined, [ { role: 'user', content: 'x' } ] as Message[]);
    (service as any)._performGitCheck = jest.fn();
    (service as any)._findRelevantHistorySlice = jest.fn().mockReturnValue([{ role:'user', content:'x' }]);
    (service as any)._determineModels = jest.fn().mockReturnValue({analysisModelName:'a',generationModelName:'b',useFlashForAnalysis:false,useFlashForGeneration:false});
    (service as any)._runAnalysisStep = jest.fn().mockResolvedValue({ operations:[{ action:'CREATE', filePath:'a.ts' }] });
    (service as any)._runGenerationStep = jest.fn().mockResolvedValue({});
    (service as any)._runApplyStep = jest.fn().mockResolvedValue(true);
    (service as any)._logSuccessMarker = jest.fn();

    await service.process('conv', convo, 'ctx', 'file');

    expect((service as any)._logSuccessMarker).toHaveBeenCalledWith('file');
    const last = convo.getLastMessage();
    expect(last?.role).toBe('system');
    expect(last?.content).toBe(CONSOLIDATION_SUCCESS_MARKER);
  });

  test('process handles failure and does not log success', async () => {
    const { service } = createService();
    const convo = new Conversation(undefined, []);
    (service as any)._performGitCheck = jest.fn().mockRejectedValue(new Error('fail'));
    (service as any)._handleConsolidationError = jest.fn();
    (service as any)._logSuccessMarker = jest.fn();

    await service.process('conv', convo, 'ctx', 'file');

    expect((service as any)._handleConsolidationError).toHaveBeenCalled();
    expect((service as any)._logSuccessMarker).not.toHaveBeenCalled();
  });

  test('determineModels returns defaults', () => {
    const { service } = createService();
    const models = (service as any)._determineModels();
    expect(models).toEqual({
      analysisModelName:'Pro',
      generationModelName:'Pro',
      useFlashForAnalysis:false,
      useFlashForGeneration:false
    });
  });

  test('runAnalysisStep handles empty operations', async () => {
    const { service } = createService();
    (service as any).consolidationAnalyzer = { analyze: jest.fn().mockResolvedValue({ operations: [] }), setAIClient: jest.fn() };
    (service as any)._logSystemMessage = jest.fn();
    const res = await (service as any)._runAnalysisStep([], 'ctx', 'file', {analysisModelName:'a',generationModelName:'b',useFlashForAnalysis:false,useFlashForGeneration:false});
    expect(res).toBeNull();
    expect((service as any)._logSystemMessage).toHaveBeenCalledWith('file', expect.stringContaining('0 ops'));
  });

  test('runAnalysisStep logs and rethrows errors', async () => {
    const { service } = createService();
    (service as any).consolidationAnalyzer = { analyze: jest.fn().mockRejectedValue(new Error('boom')), setAIClient: jest.fn() };
    (service as any)._logError = jest.fn();
    await expect((service as any)._runAnalysisStep([], 'ctx', 'file', {analysisModelName:'a',generationModelName:'b',useFlashForAnalysis:false,useFlashForGeneration:false})).rejects.toThrow('boom');
    expect((service as any)._logError).toHaveBeenCalledWith('file', expect.stringContaining('boom'));
  });

  test('runGenerationStep success', async () => {
    const { service } = createService();
    (service as any).consolidationGenerator = { generate: jest.fn().mockResolvedValue({ a: 'b' }), setAIClient: jest.fn() };
    (service as any)._logSystemMessage = jest.fn();
    const res = await (service as any)._runGenerationStep([], 'ctx', { operations:[] }, 'file', {analysisModelName:'a',generationModelName:'b',useFlashForAnalysis:false,useFlashForGeneration:false});
    expect(res).toEqual({ a: 'b' });
    expect((service as any)._logSystemMessage).toHaveBeenCalledWith('file', expect.stringContaining('states for 1 files'));
  });

  test('runGenerationStep logs and rethrows errors', async () => {
    const { service } = createService();
    (service as any).consolidationGenerator = { generate: jest.fn().mockRejectedValue(new Error('boom')), setAIClient: jest.fn() };
    (service as any)._logError = jest.fn();
    await expect((service as any)._runGenerationStep([], 'ctx', { operations:[] }, 'file', {analysisModelName:'a',generationModelName:'b',useFlashForAnalysis:false,useFlashForGeneration:false})).rejects.toThrow('boom');
    expect((service as any)._logError).toHaveBeenCalledWith('file', expect.stringContaining('boom'));
  });

  test('runApplyStep success', async () => {
    const { service } = createService();
    (service as any).consolidationApplier = { apply: jest.fn().mockResolvedValue({ success:1, failed:0, skipped:0, summary:['ok'] }) };
    (service as any)._logSystemMessage = jest.fn();
    const res = await (service as any)._runApplyStep({}, 'file');
    expect(res).toBe(true);
    expect((service as any)._logSystemMessage).toHaveBeenCalledWith('file', expect.stringContaining('Summary'));
  });

  test('runApplyStep throws on failures', async () => {
    const { service } = createService();
    (service as any).consolidationApplier = { apply: jest.fn().mockResolvedValue({ success:1, failed:1, skipped:0, summary:['fail'] }) };
    (service as any)._logError = jest.fn();
    await expect((service as any)._runApplyStep({}, 'file')).rejects.toThrow('Consolidation apply step completed with 1 failure');
    expect((service as any)._logError).toHaveBeenCalledWith('file', expect.stringContaining('Consolidation apply step completed with'));
  });

  test('handleConsolidationError logs unknown errors', async () => {
    const { service } = createService();
    (service as any)._logError = jest.fn();
    await (service as any)._handleConsolidationError(new Error('weird'), 'conv', 'file');
    expect((service as any)._logError).toHaveBeenCalledWith('file', expect.stringContaining('weird'));
  });

  test('handleConsolidationError ignores known errors', async () => {
    const { service } = createService();
    (service as any)._logError = jest.fn();
    await (service as any)._handleConsolidationError(new Error('Git Check Failed: nope'), 'conv', 'file');
    expect((service as any)._logError).not.toHaveBeenCalled();
  });

  test('logError and logSystemMessage handle failures', async () => {
    const { service } = createService();
    const failingAI = { logConversation: jest.fn().mockRejectedValue(new Error('no')) };
    (service as any).aiClient = failingAI;
    await (service as any)._logError('f', 'e');
    await (service as any)._logSystemMessage('f', 'm');
    expect(failingAI.logConversation).toHaveBeenCalledTimes(2);
  });

  test('logSuccessMarker handles errors', async () => {
    const { service } = createService();
    const ai = { logConversation: jest.fn().mockRejectedValue(new Error('x')) };
    (service as any).aiClient = ai;
    await (service as any)._logSuccessMarker('f');
    expect(ai.logConversation).toHaveBeenCalledWith('f', { type:'system', role:'system', content: CONSOLIDATION_SUCCESS_MARKER });
  });
});
