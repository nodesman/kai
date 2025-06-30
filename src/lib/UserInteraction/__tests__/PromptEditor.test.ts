import { PromptEditor, HISTORY_SEPARATOR } from '../PromptEditor';
import { FileSystem } from '../../FileSystem';

jest.mock('chalk');

describe('PromptEditor', () => {
  describe('formatHistoryForSublime and extractNewPrompt', () => {
    it('formats history for Sublime correctly', () => {
      const fs = new FileSystem();
      const editor = new PromptEditor(fs as any, { chatsDir: '' } as any);
      const msgs = [
        { role: 'user', content: 'first', timestamp: '2020-01-01T00:00:00Z' },
        { role: 'assistant', content: 'second', timestamp: '2020-01-02T00:00:00Z' }
      ];
      const out = editor.formatHistoryForSublime(msgs as any);
      expect(out).toContain('TYPE YOUR PROMPT ABOVE THIS LINE');
      expect(out).toContain('User:');
      expect(out).toContain('LLM:');
    });

    it('extracts new prompt correctly when separator is present', () => {
      const fs = new FileSystem();
      const editor = new PromptEditor(fs as any, { chatsDir: '' } as any);
      const text = `hello\n${HISTORY_SEPARATOR}\nold`;
      expect(editor.extractNewPrompt(text)).toBe('hello');
    });

    it('returns null when no prompt is entered', () => {
      const fs = new FileSystem();
      const editor = new PromptEditor(fs as any, { chatsDir: '' } as any);
      expect(editor.extractNewPrompt(`    \n${HISTORY_SEPARATOR}\n`)).toBeNull();
    });

    it('warns when separator missing', () => {
      const fs = new FileSystem();
      const editor = new PromptEditor(fs as any, { chatsDir: '' } as any);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(editor.extractNewPrompt('hello')).toBe('hello');
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('getPromptViaSublimeLoop', () => {
    let editor: PromptEditor;
    beforeEach(() => {
      jest.resetAllMocks();
      const fsInst = new FileSystem();
      editor = new PromptEditor(fsInst as any, { chatsDir: '/chats', context: {} } as any);
      jest.spyOn(fsInst, 'writeFile').mockResolvedValue(undefined as any);
      jest.spyOn(fsInst, 'readFile');
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(require('fs/promises'), 'access').mockResolvedValue(undefined);
    });
    afterEach(() => jest.unmock('child_process'));

    it('returns null when editor close code != 0', async () => {
      const fakeSpawn = { on: (_: string, cb: any) => cb(1) } as any;
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue(fakeSpawn);
      const result = await editor.getPromptViaSublimeLoop('conv', [], '/tmp/edit');
      expect(result.newPrompt).toBeNull();
    });

    it('returns extracted prompt when content changed', async () => {
      const modified = `new prompt\n${HISTORY_SEPARATOR}\nhist`;
      (editor as any).fs.readFile.mockResolvedValue(modified);
      const fakeSpawn = { on: (_: string, cb: any) => cb(0) } as any;
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue(fakeSpawn);
      const res = await editor.getPromptViaSublimeLoop('conv', [], '/tmp/edit');
      expect(res.newPrompt).toBe('new prompt');
    });

    it('falls back from JetBrains IDE to Sublime when spawn errors ENOENT', async () => {
      const error = { code: 'ENOENT' };
      let call = 0;
      jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => {
        call++;
        if (call === 1) throw error;
        return { on: (_: string, cb: any) => cb(0) } as any;
      });
      (editor as any).fs.readFile.mockResolvedValue(`p\n${HISTORY_SEPARATOR}`);
      await expect(editor.getPromptViaSublimeLoop('c', [], '/tmp/e')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('retries with Sublime and succeeds when JetBrains launcher fails', async () => {
      const error = { code: 'ENOENT' };
      let call = 0;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      process.env.__CFBundleIdentifier = 'com.jetbrains.WebStorm';
      jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => {
        call++;
        return {
          on: (ev: string, cb: any) => {
            if (call === 1 && ev === 'error') cb(error);
            if (call === 2 && ev === 'close') cb(0);
          },
        } as any;
      });
      (editor as any).fs.readFile.mockResolvedValue(`np\n${HISTORY_SEPARATOR}`);
      const logSpy = console.log as jest.Mock;
      const res = await editor.getPromptViaSublimeLoop('c', [], '/tmp/edit');
      expect(res.newPrompt).toBe('np');
      expect(call).toBe(2);
      expect(logSpy).toHaveBeenCalled();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.__CFBundleIdentifier;
    });

    it('throws error when fallback editor is also missing', async () => {
      const error = { code: 'ENOENT' };
      let call = 0;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      process.env.__CFBundleIdentifier = 'com.jetbrains.WebStorm';
      jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => {
        call++;
        return {
          on: (ev: string, cb: any) => {
            if (ev === 'error') cb(error);
          },
        } as any;
      });
      (editor as any).fs.readFile.mockResolvedValue(`x\n${HISTORY_SEPARATOR}`);
      await expect(editor.getPromptViaSublimeLoop('c', [], '/tmp/edit')).rejects.toThrow();
      expect(call).toBe(2);
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.__CFBundleIdentifier;
    });
  });

  describe('additional getPromptViaSublimeLoop flows', () => {
    let editor: PromptEditor;
    beforeEach(() => {
      jest.resetAllMocks();
      const fsInst = new FileSystem();
      editor = new PromptEditor(fsInst as any, { chatsDir: '/chats', context: {} } as any);
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('handles missing editor file', async () => {
      const fsInst = (editor as any).fs;
      jest.spyOn(fsInst, 'writeFile').mockResolvedValue(undefined as any);
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      jest.spyOn(require('fs/promises'), 'access').mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }));
      const res = await editor.getPromptViaSublimeLoop('c', [], '/tmp/edit');
      expect(res.newPrompt).toBeNull();
    });

    it('returns null when no changes made', async () => {
      const fsInst = (editor as any).fs;
      let content = '';
      jest.spyOn(fsInst, 'writeFile').mockImplementation((_f, d) => { content = d as any; return Promise.resolve(); });
      jest.spyOn(require('fs/promises'), 'access').mockResolvedValue(undefined);
      jest.spyOn(fsInst, 'readFile').mockImplementation(async () => content);
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      const res = await editor.getPromptViaSublimeLoop('c', [], '/tmp/edit');
      expect(res.newPrompt).toBeNull();
    });

    it('returns null when no prompt extracted', async () => {
      const fsInst = (editor as any).fs;
      jest.spyOn(fsInst, 'writeFile').mockResolvedValue(undefined as any);
      jest.spyOn(fsInst, 'readFile').mockResolvedValue(`   \n${HISTORY_SEPARATOR}\nold`);
      jest.spyOn(require('fs/promises'), 'access').mockResolvedValue(undefined);
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      const res = await editor.getPromptViaSublimeLoop('c', [], '/tmp/edit');
      expect(res.newPrompt).toBeNull();
    });

    it('throws when readFile fails unexpectedly', async () => {
      const fsInst = (editor as any).fs;
      jest.spyOn(fsInst, 'writeFile').mockResolvedValue(undefined as any);
      jest.spyOn(require('fs/promises'), 'access').mockResolvedValue(undefined);
      jest.spyOn(fsInst, 'readFile').mockRejectedValue(new Error('boom'));
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      await expect(editor.getPromptViaSublimeLoop('c', [], '/tmp/edit')).rejects.toThrow('boom');
    });

    it('throws when writeFile fails', async () => {
      const fsInst = (editor as any).fs;
      jest.spyOn(fsInst, 'writeFile').mockRejectedValue(new Error('fail'));
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      await expect(editor.getPromptViaSublimeLoop('c', [], '/tmp/edit')).rejects.toThrow('fail');
    });
  });
});
