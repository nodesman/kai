jest.mock('inquirer');
jest.mock('chalk');
const inquirer = require('inquirer');
import chalk from 'chalk';
import { UserInterface } from '../UserInterface';
const baseConfig = { chatsDir: '/chats', gemini: { model_name: 'm1', subsequent_chat_model_name: 'm2' }, context: { mode: 'full' } };

describe('UserInterface', () => {
  beforeEach(() => jest.resetAllMocks());

  it('prompts user to confirm initialization when directory is safe', async () => {
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirm: true });
    const ui = new UserInterface({} as any);
    const ans = await ui.confirmInitialization('/path', true);
    expect(inquirer.prompt).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'confirm' })
    ]);
    expect(ans).toBe(true);
  });

  it('prompts user to confirm initialization when directory is unsafe', async () => {
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirm: false });
    const ui = new UserInterface({} as any);
    const ans = await ui.confirmInitialization('/path', false);
    expect(inquirer.prompt).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'confirm' })
    ]);
    expect(ans).toBe(false);
  });

  it('displays changed files when files list is non-empty', () => {
    const ui = new UserInterface({} as any);
    const spy = jest.spyOn(console, 'log').mockImplementation();
    ui.displayChangedFiles(['a', 'b']);
    expect(spy).toHaveBeenCalledWith(chalk.cyan('\nModified files:'));
    expect(spy).toHaveBeenCalledWith('  - a');
    expect(spy).toHaveBeenCalledWith('  - b');
    spy.mockRestore();
  });

  it('does nothing when there are no changed files', () => {
    const ui = new UserInterface({} as any);
    const spy = jest.spyOn(console, 'log').mockImplementation();
    ui.displayChangedFiles([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('asks to generate commit message and returns answer', async () => {
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ commit: true });
    const ui = new UserInterface({} as any);
    const ans = await ui.promptGenerateCommit();
    expect(inquirer.prompt).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'confirm' })
    ]);
    expect(ans).toBe(true);
  });

  it('confirms commit message and returns answer', async () => {
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ confirm: false });
    const ui = new UserInterface({} as any);
    const ans = await ui.confirmCommitMessage('msg');
    expect(inquirer.prompt).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'confirm' })
    ]);
    expect(ans).toBe(false);
  });

  it('formats history for Sublime correctly', () => {
    const ui = new UserInterface({} as any);
    const msgs = [
      { role: 'user', content: 'first', timestamp: '2020-01-01T00:00:00Z' },
      { role: 'assistant', content: 'second', timestamp: '2020-01-02T00:00:00Z' }
    ];
    const out = ui.formatHistoryForSublime(msgs as any);
    expect(out).toContain('TYPE YOUR PROMPT ABOVE THIS LINE');
    expect(out).toContain('User:');
    expect(out).toContain('LLM:');
  });

  it('extracts new prompt correctly when separator is present', () => {
    const ui = new UserInterface({} as any);
    const sep = '--- TYPE YOUR PROMPT ABOVE THIS LINE ---';
    const text = `hello\n${sep}\nold`;
    expect(ui.extractNewPrompt(text)).toBe('hello');
  });

  it('returns null when no prompt is entered', () => {
    const ui = new UserInterface({} as any);
    const sep = '--- TYPE YOUR PROMPT ABOVE THIS LINE ---';
    expect(ui.extractNewPrompt(`    \n${sep}\n`)).toBeNull();
  });

  describe('getPromptViaSublimeLoop', () => {
    let ui: UserInterface;
    const origSpawn = jest.requireActual('child_process').spawn;
    beforeEach(() => {
      jest.resetAllMocks();
      ui = new UserInterface({ chatsDir: '/chats', context: {} } as any);
      jest.spyOn(ui.fs, 'writeFile').mockResolvedValue();
      jest.spyOn(ui.fs, 'readFile');
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(require('fs/promises'), 'access').mockResolvedValue(undefined);
    });
    afterEach(() => jest.unmock('child_process'));

    it('returns null when editor close code != 0', async () => {
      const fakeSpawn = { on: (_: string, cb: any) => cb(1) } as any;
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue(fakeSpawn);
      const result = await ui.getPromptViaSublimeLoop('conv', [], '/tmp/edit');
      expect(result.newPrompt).toBeNull();
    });

    it('returns extracted prompt when content changed', async () => {
      const modified = 'new prompt\n--- TYPE YOUR PROMPT ABOVE THIS LINE ---\nhist';
      (ui.fs.readFile as jest.Mock).mockResolvedValue(modified);
      const fakeSpawn = { on: (_: string, cb: any) => cb(0) } as any;
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue(fakeSpawn);
      const res = await ui.getPromptViaSublimeLoop('conv', [], '/tmp/edit');
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
      (ui.fs.readFile as jest.Mock).mockResolvedValue('p\n--- TYPE YOUR PROMPT ABOVE THIS LINE ---');
      await expect(ui.getPromptViaSublimeLoop('c', [], '/tmp/e')).rejects.toMatchObject({ code: 'ENOENT' });
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
      (ui.fs.readFile as jest.Mock).mockResolvedValue('np\n--- TYPE YOUR PROMPT ABOVE THIS LINE ---');
      const logSpy = console.log as jest.Mock;
      const res = await ui.getPromptViaSublimeLoop('c', [], '/tmp/edit');
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
      (ui.fs.readFile as jest.Mock).mockResolvedValue('x\n--- TYPE YOUR PROMPT ABOVE THIS LINE ---');
      await expect(ui.getPromptViaSublimeLoop('c', [], '/tmp/edit')).rejects.toThrow();
      expect(call).toBe(2);
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.__CFBundleIdentifier;
    });
  });

  describe('getUserInteraction flows', () => {
    let ui: UserInterface;
    beforeEach(() => {
      jest.resetAllMocks();
      ui = new UserInterface(baseConfig as any);
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('handles Delete Conversation... cancel and confirm', async () => {
      jest.spyOn(ui.fs, 'ensureKaiDirectoryExists').mockResolvedValue(undefined);
      jest.spyOn(ui.fs, 'listJsonlFiles').mockResolvedValue(['a']);
      const logSpy = console.log as jest.Mock;
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Delete Conversation...' })
        .mockResolvedValueOnce({ conversationsToDelete: ['a'] })
        .mockResolvedValueOnce({ confirmDelete: false });
      const res1 = await ui.getUserInteraction();
      expect(res1).toBeNull();
      expect(logSpy).toHaveBeenCalled();
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Delete Conversation...' })
        .mockResolvedValueOnce({ conversationsToDelete: ['a'] })
        .mockResolvedValueOnce({ confirmDelete: true });
      const res2 = await ui.getUserInteraction();
      expect(res2).toEqual({ mode: 'Delete Conversation...', conversationNamesToDelete: ['a'] });
    });

    it('warns on unhandled mode', async () => {
      jest.spyOn(ui.fs, 'ensureKaiDirectoryExists').mockResolvedValue(undefined);
      jest.spyOn(ui, 'selectOrCreateConversation').mockResolvedValue({ name: 'c', isNew: false });
      const warnSpy = console.warn as jest.Mock;
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Bogus' })
        .mockResolvedValueOnce({ modelChoice: 'm1' });
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('errors when consolidating a new conversation', async () => {
      jest.spyOn(ui.fs, 'ensureKaiDirectoryExists').mockResolvedValue(undefined);
      jest.spyOn(ui, 'selectOrCreateConversation').mockResolvedValue({ name: 'c', isNew: true });
      const errSpy = console.error as jest.Mock;
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Consolidate Changes...' })
        .mockResolvedValueOnce({ modelChoice: 'm1' });
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    });

    it('handles isTtyError gracefully', async () => {
      (inquirer.prompt as jest.Mock).mockRejectedValue({ isTtyError: true });
      const errSpy = console.error as jest.Mock;
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    });

    it('handles fallback error object', async () => {
      (inquirer.prompt as jest.Mock).mockRejectedValue({ type: 'fallback' });
      const errSpy = console.error as jest.Mock;
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    });

    it('handles command not found errors', async () => {
      (inquirer.prompt as jest.Mock).mockRejectedValue(new Error('idea command not found'));
      const errSpy = console.error as jest.Mock;
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    });

    it('logs generic errors', async () => {
      (inquirer.prompt as jest.Mock).mockRejectedValue(new Error('oops'));
      const errSpy = console.error as jest.Mock;
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    });
  });
});