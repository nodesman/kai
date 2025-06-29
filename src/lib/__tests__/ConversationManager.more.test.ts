import Conversation from '../models/Conversation';
import { ConversationManager } from '../ConversationManager';

describe('ConversationManager additional coverage', () => {
  let config: any;
  let fs: any;
  let aiClient: any;
  let ui: any;
  let builder: any;
  let consolidation: any;
  let manager: ConversationManager;

  beforeEach(() => {
    config = { chatsDir: '/tmp', context: { mode: 'full' } };
    fs = { access: jest.fn(), deleteFile: jest.fn() };
    aiClient = { getResponseFromAI: jest.fn(), logConversation: jest.fn() };
    ui = { getPromptViaSublimeLoop: jest.fn() };
    builder = { buildContext: jest.fn(), buildDynamicContext: jest.fn() };
    consolidation = {};
    manager = new ConversationManager(config, fs, aiClient, ui, builder, consolidation);
  });

  it('updates AI client and uses it when calling AI', async () => {
    const convo = new Conversation();
    convo.addMessage('assistant', 'old');
    config.context.mode = 'dynamic';
    builder.buildDynamicContext.mockResolvedValue({ context: 'ctx', tokenCount: 1 });
    const newAI = { getResponseFromAI: jest.fn().mockResolvedValue(undefined), logConversation: jest.fn() };
    manager.updateAIClient(newAI as any);
    await (manager as any)._callAIWithContext(convo, 'hi', '/c.jsonl');
    expect(newAI.getResponseFromAI).toHaveBeenCalledWith(convo, '/c.jsonl', 'ctx', false);
  });

  it('handles user loop until null prompt', async () => {
    const convo = new Conversation();
    ui.getPromptViaSublimeLoop
      .mockResolvedValueOnce({ newPrompt: 'hello' })
      .mockResolvedValueOnce({ newPrompt: null });
    const spy = jest.spyOn<any, any>(manager as any, '_processLoopIteration').mockResolvedValue(undefined);
    await (manager as any)._handleUserInputLoop('nm', convo, { conversationFilePath: '/c.jsonl', editorFilePath: '/e.txt' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('adds system message on AI error', async () => {
    const convo = new Conversation();
    builder.buildContext.mockResolvedValue({ context: 'ctx', tokenCount: 1 });
    aiClient.getResponseFromAI.mockRejectedValue(new Error('boom'));
    aiClient.logConversation.mockRejectedValueOnce(new Error('log'));
    await (manager as any)._callAIWithContext(convo, 'prompt', '/c.jsonl');
    const msg = convo.getMessages().find(m => m.role === 'system');
    expect(msg?.content).toContain('System Error during AI request');
    expect(aiClient.logConversation).toHaveBeenCalledWith('/c.jsonl', expect.objectContaining({ type: 'error' }));
  });

  it('handles context build failure specially', async () => {
    const convo = new Conversation();
    builder.buildContext.mockRejectedValue(new Error('Cannot build context'));
    aiClient.logConversation.mockResolvedValue(undefined);
    await (manager as any)._callAIWithContext(convo, 'p', '/c.jsonl');
    const msg = convo.getMessages().find(m => m.role === 'system');
    expect(msg?.content).toContain('System Error building context');
  });

  it('logs conversation errors when possible', async () => {
    aiClient.logConversation.mockResolvedValue(undefined);
    await (manager as any)._handleConversationError(new Error('x'), 'name', '/path');
    expect(aiClient.logConversation).toHaveBeenCalledWith('/path', expect.objectContaining({ error: expect.any(String) }));
  });

  it('skips logging when path missing', async () => {
    aiClient.logConversation.mockResolvedValue(undefined);
    await (manager as any)._handleConversationError(new Error('x'), 'name', null);
    expect(aiClient.logConversation).not.toHaveBeenCalled();
  });

  it('logs diff failures and handles log errors', async () => {
    const convo = new Conversation();
    const info = { file: 'a.ts', error: 'err', fileContent: 'old', diff: 'patch' };
    aiClient.logConversation.mockRejectedValueOnce(new Error('no'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await manager.handleDiffFailure(convo, '/c.jsonl', info as any);
    expect(convo.getMessages().pop()?.content).toContain('Diff Apply Failure');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('runs consolidate with dynamic context', async () => {
    const convo = new Conversation();
    config.context.mode = 'dynamic';
    aiClient.logConversation.mockResolvedValue(undefined);
    builder.buildDynamicContext.mockResolvedValue({ context: 'ctx', tokenCount: 1 });
    consolidation.process = jest.fn().mockResolvedValue(undefined);
    await (manager as any)._handleConsolidateCommand(convo, '/c.jsonl');
    expect(builder.buildDynamicContext).toHaveBeenCalled();
    const last = convo.getMessages().find(m => m.role === 'system');
    expect(last?.content).toContain('System: Consolidation process triggered');
  });

  it('handles consolidate log failure', async () => {
    const convo = new Conversation();
    config.context.mode = 'full';
    builder.buildContext.mockResolvedValue({ context: 'ctx', tokenCount: 1 });
    consolidation.process = jest.fn().mockRejectedValue(new Error('boom'));
    aiClient.logConversation.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('err'));
    await (manager as any)._handleConsolidateCommand(convo, '/c.jsonl');
    expect(aiClient.logConversation).toHaveBeenCalledTimes(2);
  });

  it('logs error when conversation log fails', async () => {
    aiClient.logConversation.mockRejectedValue(new Error('bad'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await (manager as any)._handleConversationError(new Error('x'), 'name', '/p');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
