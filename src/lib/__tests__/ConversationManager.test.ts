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
});

