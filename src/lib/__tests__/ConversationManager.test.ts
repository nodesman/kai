import path from 'path';
import Conversation from '../models/Conversation';
import { ConversationManager } from '../ConversationManager';

describe('ConversationManager private flows', () => {
  const config = { chatsDir: '/tmp/chats', context: { mode: 'full' } } as any;
  const fs = {} as any;
  const aiClient = {} as any;
  const ui = {} as any;
  const builder = {} as any;
  const consolidation = {} as any;
  let manager: ConversationManager;

  beforeEach(() => {
    manager = new ConversationManager(config, fs, aiClient, ui, builder, consolidation);
  });

  describe('_processLoopIteration', () => {
    it('handles /consolidate command', async () => {
      const convo = new Conversation();
      const spyCons = jest.spyOn<any, any>(manager as any, '_handleConsolidateCommand').mockResolvedValue(undefined);
      const spyAI = jest.spyOn<any, any>(manager as any, '_callAIWithContext').mockResolvedValue(undefined);

      await (manager as any)._processLoopIteration(convo, '/consolidate', '/c');

      expect(spyCons).toHaveBeenCalledWith(convo, '/c');
      expect(spyAI).not.toHaveBeenCalled();
    });

    it('handles regular prompt', async () => {
      const convo = new Conversation();
      const spyCons = jest.spyOn<any, any>(manager as any, '_handleConsolidateCommand').mockResolvedValue(undefined);
      const spyAI = jest.spyOn<any, any>(manager as any, '_callAIWithContext').mockResolvedValue(undefined);

      await (manager as any)._processLoopIteration(convo, 'hello', '/c');

      expect(spyAI).toHaveBeenCalledWith(convo, 'hello', '/c');
      expect(spyCons).not.toHaveBeenCalled();
    });
  });

  describe('runSession', () => {
    it('loads conversation and runs loop', async () => {
      const convo = new Conversation();
      const load = jest.spyOn<any, any>(manager as any, '_loadOrCreateConversation').mockResolvedValue(convo);
      const loop = jest.spyOn<any, any>(manager as any, '_handleUserInputLoop').mockResolvedValue(undefined);
      const cleanup = jest.spyOn<any, any>(manager as any, '_cleanupEditorFile').mockResolvedValue(undefined);

      await manager.runSession('Chat One', true);

      const snake = 'chat_one';
      const expectedPath = path.join(config.chatsDir, `${snake}.jsonl`);
      expect(load).toHaveBeenCalledWith('Chat One', true, expectedPath);
      expect(loop).toHaveBeenCalledWith('Chat One', convo, expect.objectContaining({ conversationFilePath: expectedPath }));
      expect(cleanup).toHaveBeenCalled();
    });

    it('handles errors and calls error handler', async () => {
      const err = new Error('boom');
      jest.spyOn<any, any>(manager as any, '_loadOrCreateConversation').mockRejectedValue(err);
      const handleErr = jest.spyOn<any, any>(manager as any, '_handleConversationError').mockResolvedValue(undefined);
      const cleanup = jest.spyOn<any, any>(manager as any, '_cleanupEditorFile').mockResolvedValue(undefined);

      await manager.runSession('Oops', false);

      expect(handleErr).toHaveBeenCalledWith(err, 'Oops', expect.any(String));
      expect(cleanup).toHaveBeenCalled();
    });
  });

  describe('utility helpers', () => {
    it('generates expected conversation paths', () => {
      const paths = (manager as any)._getConversationPaths('My Chat');
      expect(paths.conversationFilePath).toContain('my_chat.jsonl');
      expect(paths.editorFilePath).toContain('my_chat_edit.txt');
    });

    describe('_loadOrCreateConversation', () => {
      it('loads existing conversation file', async () => {
        const logs = [{ type: 'request', role: 'user', content: 'hi', timestamp: 't' }];
        fs.readJsonlFile = jest.fn().mockResolvedValue(logs);
        const convo = await (manager as any)._loadOrCreateConversation('Chat', false, '/c');
        expect(fs.readJsonlFile).toHaveBeenCalledWith('/c');
        expect(convo.getMessages()).toHaveLength(1);
      });

      it('creates new conversation when file missing', async () => {
        fs.readJsonlFile = jest.fn().mockRejectedValue({ code: 'ENOENT' });
        const convo = await (manager as any)._loadOrCreateConversation('Chat', false, '/c');
        expect(convo.getMessages()).toHaveLength(0);
      });

      it('rethrows unexpected errors', async () => {
        fs.readJsonlFile = jest.fn().mockRejectedValue(new Error('fail'));
        await expect((manager as any)._loadOrCreateConversation('Chat', false, '/c')).rejects.toThrow('fail');
      });
    });

    describe('_cleanupEditorFile', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      afterEach(() => {
        logSpy.mockClear();
        warnSpy.mockClear();
      });

      it('deletes existing file', async () => {
        fs.access = jest.fn().mockResolvedValue(undefined);
        fs.deleteFile = jest.fn().mockResolvedValue(undefined);
        await (manager as any)._cleanupEditorFile('/e');
        expect(fs.deleteFile).toHaveBeenCalledWith('/e');
      });

      it('handles missing file gracefully', async () => {
        fs.access = jest.fn().mockRejectedValue({ code: 'ENOENT' });
        fs.deleteFile = jest.fn();
        await (manager as any)._cleanupEditorFile('/e');
        expect(fs.deleteFile).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalled();
      });

      it('warns when deletion fails', async () => {
        fs.access = jest.fn().mockResolvedValue(undefined);
        fs.deleteFile = jest.fn().mockRejectedValue(new Error('bad'));
        await (manager as any)._cleanupEditorFile('/e');
        expect(warnSpy).toHaveBeenCalled();
      });

      it('warns when access fails', async () => {
        fs.access = jest.fn().mockRejectedValue(new Error('nope'));
        fs.deleteFile = jest.fn();
        await (manager as any)._cleanupEditorFile('/e');
        expect(fs.deleteFile).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
      });

      it('skips when path is null', async () => {
        fs.access = jest.fn();
        fs.deleteFile = jest.fn();
        await (manager as any)._cleanupEditorFile(null);
        expect(fs.access).not.toHaveBeenCalled();
        expect(fs.deleteFile).not.toHaveBeenCalled();
      });
    });

    describe('_handleConsolidateCommand', () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      afterEach(() => {
        errSpy.mockClear();
      });

      it('logs when initial log fails', async () => {
        const convo = new Conversation();
        aiClient.logConversation = jest.fn().mockRejectedValue(new Error('oops'));
        builder.buildContext = jest.fn().mockResolvedValue({ context: 'ctx', tokenCount: 1 });
        consolidation.process = jest.fn().mockResolvedValue(undefined);
        await (manager as any)._handleConsolidateCommand(convo, '/c.jsonl');
        expect(errSpy).toHaveBeenCalled();
      });

      it('handles consolidation errors', async () => {
        const convo = new Conversation();
        aiClient.logConversation = jest.fn().mockResolvedValue(undefined);
        builder.buildContext = jest.fn().mockResolvedValue({ context: 'ctx', tokenCount: 1 });
        consolidation.process = jest.fn().mockRejectedValue(new Error('fail'));

        await (manager as any)._handleConsolidateCommand(convo, '/c.jsonl');

        expect(errSpy).toHaveBeenCalled();
        expect(aiClient.logConversation).toHaveBeenCalledWith('/c.jsonl', expect.objectContaining({ type: 'error' }));
        const systemMsg = convo.getMessages().find(m => m.role === 'system');
        expect(systemMsg?.content).toContain('System Error during');
      });

      it('logs when context build fails', async () => {
        const convo = new Conversation();
        aiClient.logConversation = jest.fn().mockResolvedValue(undefined);
        builder.buildContext = jest.fn().mockRejectedValue(new Error('ctx'));
        consolidation.process = jest.fn();

        await (manager as any)._handleConsolidateCommand(convo, '/c.jsonl');

        expect(consolidation.process).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalled();
        expect(aiClient.logConversation).toHaveBeenCalledWith('/c.jsonl', expect.objectContaining({ type: 'error' }));
        const sysMsg = convo.getMessages().find(m => m.role === 'system');
        expect(sysMsg?.content).toContain('System Error during');
      });
    });

    describe('_findRelevantHistorySlice and _summarizeHistory', () => {
      it('returns slice after last success marker', () => {
        const convo = new Conversation();
        convo.addMessage('user', 'a');
        convo.addMessage('system', '[System: Consolidation Completed Successfully]');
        convo.addMessage('assistant', 'b');
        const slice = (manager as any)._findRelevantHistorySlice(convo);
        expect(slice).toHaveLength(1);
        const summary = (manager as any)._summarizeHistory(slice);
        expect(summary).toContain('assistant');
      });

      it('returns null summary for empty history', () => {
        expect((manager as any)._summarizeHistory([])).toBeNull();
      });
    });
  });
});

