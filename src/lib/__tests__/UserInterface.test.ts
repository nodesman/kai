jest.mock('inquirer');
jest.mock('chalk');
const inquirer = require('inquirer');
import chalk from 'chalk';
import { UserInterface } from '../UserInterface';

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
  });
});