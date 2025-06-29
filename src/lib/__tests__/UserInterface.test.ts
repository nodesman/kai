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

  it('warns when separator missing', () => {
    const ui = new UserInterface({} as any);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ui.extractNewPrompt('hello')).toBe('hello');
    expect(warn).toHaveBeenCalled();
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

  describe('selectOrCreateConversation', () => {
    let ui: UserInterface;
    beforeEach(() => {
      jest.resetAllMocks();
      ui = new UserInterface(baseConfig as any);
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('returns existing conversation when selected', async () => {
      jest.spyOn(ui.fs, 'listJsonlFiles').mockResolvedValue(['c1']);
      (inquirer.prompt as jest.Mock).mockResolvedValueOnce({ selected: 'c1' });
      const res = await ui.selectOrCreateConversation();
      expect(res).toEqual({ name: 'c1', isNew: false });
    });

    it('creates new conversation when name not taken', async () => {
      jest.spyOn(ui.fs, 'listJsonlFiles').mockResolvedValue(['c1']);
      let question: any;
      (inquirer.prompt as jest.Mock)
        .mockImplementationOnce(async qs => { return { selected: '<< Create New Conversation >>' }; })
        .mockImplementationOnce(async qs => { question = qs[0]; return { newName: 'My Chat' }; });
      const res = await ui.selectOrCreateConversation();
      expect(question.validate('')).toBe('Conversation name cannot be empty.');
      expect(question.validate('x')).toBe(true);
      expect(question.filter('  x ')).toBe('x');
      expect(res).toEqual({ name: 'My Chat', isNew: true });
    });

    it('reuses conversation when name already exists', async () => {
      jest.spyOn(ui.fs, 'listJsonlFiles').mockResolvedValue(['my_chat']);
      const warn = console.warn as jest.Mock;
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ selected: '<< Create New Conversation >>' })
        .mockResolvedValueOnce({ newName: 'My Chat' });
      const res = await ui.selectOrCreateConversation();
      expect(res).toEqual({ name: 'my_chat', isNew: false });
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('_detectJest', () => {
    let ui: UserInterface;
    const fsPromises = require('fs/promises');
    beforeEach(() => {
      jest.resetAllMocks();
      ui = new UserInterface(baseConfig as any);
    });

    it('detects jest via package.json', async () => {
      jest.spyOn(fsPromises, 'readFile').mockResolvedValue(JSON.stringify({ devDependencies: { jest: '^1' } }));
      const res = await (ui as any)._detectJest();
      expect(res).toBe(true);
    });

    it('detects jest via config file', async () => {
      jest.spyOn(fsPromises, 'readFile').mockRejectedValue(new Error('x'));
      jest.spyOn(fsPromises, 'access').mockResolvedValue(undefined);
      const res = await (ui as any)._detectJest();
      expect(res).toBe(true);
    });

    it('returns false when not detected', async () => {
      jest.spyOn(fsPromises, 'readFile').mockRejectedValue(new Error('x'));
      jest.spyOn(fsPromises, 'access').mockRejectedValue(new Error('x'));
      const res = await (ui as any)._detectJest();
      expect(res).toBe(false);
    });
  });

  describe('additional getPromptViaSublimeLoop flows', () => {
    let ui: UserInterface;
    beforeEach(() => {
      jest.resetAllMocks();
      ui = new UserInterface({ chatsDir: '/chats', context: {} } as any);
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('handles missing editor file', async () => {
      jest.spyOn(ui.fs, 'writeFile').mockResolvedValue();
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      jest.spyOn(require('fs/promises'), 'access').mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }));
      const res = await ui.getPromptViaSublimeLoop('c', [], '/tmp/edit');
      expect(res.newPrompt).toBeNull();
    });

    it('returns null when no changes made', async () => {
      let content = '';
      jest.spyOn(ui.fs, 'writeFile').mockImplementation((_f, d) => { content = d; return Promise.resolve(); });
      jest.spyOn(require('fs/promises'), 'access').mockResolvedValue(undefined);
      jest.spyOn(ui.fs, 'readFile').mockImplementation(async () => content);
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      const res = await ui.getPromptViaSublimeLoop('c', [], '/tmp/edit');
      expect(res.newPrompt).toBeNull();
    });

    it('returns null when no prompt extracted', async () => {
      jest.spyOn(ui.fs, 'writeFile').mockResolvedValue();
      jest.spyOn(ui.fs, 'readFile').mockResolvedValue('   \n--- TYPE YOUR PROMPT ABOVE THIS LINE ---\nold');
      jest.spyOn(require('fs/promises'), 'access').mockResolvedValue(undefined);
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      const res = await ui.getPromptViaSublimeLoop('c', [], '/tmp/edit');
      expect(res.newPrompt).toBeNull();
    });

    it('throws when readFile fails unexpectedly', async () => {
      jest.spyOn(ui.fs, 'writeFile').mockResolvedValue();
      jest.spyOn(require('fs/promises'), 'access').mockResolvedValue(undefined);
      jest.spyOn(ui.fs, 'readFile').mockRejectedValue(new Error('boom'));
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      await expect(ui.getPromptViaSublimeLoop('c', [], '/tmp/edit')).rejects.toThrow('boom');
    });

    it('throws when writeFile fails', async () => {
      jest.spyOn(ui.fs, 'writeFile').mockRejectedValue(new Error('fail'));
      jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ on: (e: string, cb: any) => e === 'close' && cb(0) } as any);
      await expect(ui.getPromptViaSublimeLoop('c', [], '/tmp/edit')).rejects.toThrow('fail');
    });
  });

  describe('additional getUserInteraction modes', () => {
    let ui: UserInterface;
    beforeEach(() => {
      jest.resetAllMocks();
      ui = new UserInterface(baseConfig as any);
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(ui.fs, 'ensureKaiDirectoryExists').mockResolvedValue(undefined);
    });

    it('exits on Exit Kai selection', async () => {
      (inquirer.prompt as jest.Mock).mockResolvedValueOnce({ mode: 'Exit Kai' });
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
    });

    it('handles Re-run Project Analysis', async () => {
      (inquirer.prompt as jest.Mock).mockResolvedValueOnce({ mode: 'Re-run Project Analysis' });
      const res = await ui.getUserInteraction();
      expect(res).toEqual({ mode: 'Re-run Project Analysis', conversationName: null, isNewConversation: false, selectedModel: '' });
    });

    it('changes context mode', async () => {
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Change Context Mode' })
        .mockResolvedValueOnce({ newModeChoice: 'analysis_cache' });
      const res = await ui.getUserInteraction();
      expect(res).toEqual({ mode: 'Change Context Mode', newMode: 'analysis_cache' });
    });

    it('scaffolds new project', async () => {
      let question: any;
      (inquirer.prompt as jest.Mock)
        .mockImplementationOnce(async qs => { return { mode: 'Scaffold New Project' }; })
        .mockImplementationOnce(async qs => { question = qs[0]; return { directoryName: 'dir' }; })
        .mockResolvedValueOnce({ language: 'TypeScript' })
        .mockResolvedValueOnce({ framework: 'Node' });
      const res = await ui.getUserInteraction();
      expect(question.validate('')).toBe('Directory name cannot be empty.');
      expect(question.validate('a')).toBe(true);
      expect(res).toEqual({ mode: 'Scaffold New Project', language: 'TypeScript', framework: 'Node', directoryName: 'dir' });
    });

    it('handles Harden mode with no frameworks', async () => {
      jest.spyOn(ui as any, '_detectJest').mockResolvedValue(false);
      (inquirer.prompt as jest.Mock).mockResolvedValueOnce({ mode: 'Harden' });
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
    });

    it('handles Harden mode with jest', async () => {
      jest.spyOn(ui as any, '_detectJest').mockResolvedValue(true);
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Harden' })
        .mockResolvedValueOnce({ toolChoice: 'Jest' })
        .mockResolvedValueOnce({ modelChoice: 'm2' });
      const res = await ui.getUserInteraction();
      expect(res).toEqual({ mode: 'Harden', tool: 'jest', selectedModel: 'm2' });
    });

    it('returns null when no conversations exist to delete', async () => {
      jest.spyOn(ui.fs, 'listJsonlFiles').mockResolvedValue([]);
      (inquirer.prompt as jest.Mock).mockResolvedValueOnce({ mode: 'Delete Conversation...' });
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
    });

    it('returns null when no conversations selected for deletion', async () => {
      jest.spyOn(ui.fs, 'listJsonlFiles').mockResolvedValue(['a']);
      let question:any;
      (inquirer.prompt as jest.Mock)
        .mockImplementationOnce(async qs => { return { mode: 'Delete Conversation...' }; })
        .mockImplementationOnce(async qs => { question = qs[0]; return { conversationsToDelete: [] }; });
      const res = await ui.getUserInteraction();
      expect(question.validate([])).toBe(true);
      expect(res).toBeNull();
    });

    it('start conversation errors when missing name', async () => {
      jest.spyOn(ui, 'selectOrCreateConversation').mockResolvedValue({ name: undefined, isNew: false } as any);
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Start/Continue Conversation' })
        .mockResolvedValueOnce({ modelChoice: 'm1' });
      const errSpy = console.error as jest.Mock;
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    });

    it('consolidate errors when name missing', async () => {
      jest.spyOn(ui, 'selectOrCreateConversation').mockResolvedValue({ name: undefined, isNew: false } as any);
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Consolidate Changes...' })
        .mockResolvedValueOnce({ modelChoice: 'm1' });
      const errSpy = console.error as jest.Mock;
      const res = await ui.getUserInteraction();
      expect(res).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    });

    it('returns start conversation details', async () => {
      jest.spyOn(ui, 'selectOrCreateConversation').mockResolvedValue({ name: 'c', isNew: false });
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Start/Continue Conversation' })
        .mockResolvedValueOnce({ modelChoice: 'm1' });
      const res = await ui.getUserInteraction();
      expect(res).toEqual({ mode: 'Start/Continue Conversation', conversationName: 'c', isNewConversation: false, selectedModel: 'm1' });
    });

    it('returns consolidate conversation details', async () => {
      jest.spyOn(ui, 'selectOrCreateConversation').mockResolvedValue({ name: 'c', isNew: false });
      (inquirer.prompt as jest.Mock)
        .mockResolvedValueOnce({ mode: 'Consolidate Changes...' })
        .mockResolvedValueOnce({ modelChoice: 'm1' });
      const res = await ui.getUserInteraction();
      expect(res).toEqual({ mode: 'Consolidate Changes...', conversationName: 'c', isNewConversation: false, selectedModel: 'm1' });
    });
  });
});