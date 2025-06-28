import { GitService } from '../GitService';
import { execFile as execFileCb } from 'child_process';

// Chalk is ESM-only which Jest struggles to load in the CommonJS test environment
// so we provide a simple manual mock that returns proxy functions.
jest.mock('chalk', () => ({ __esModule: true, default: new Proxy({}, { get: () => (s: string) => s }) }));

jest.mock('child_process', () => {
  const execFile = jest.fn((cmd: string, args: string[], opts: any, cb: (err: any, stdout?: string, stderr?: string) => void) => {
    if (typeof opts === 'function') {
      cb = opts as any;
      opts = undefined;
    }
    cb(null, '', '');
  });
  return { execFile };
});

describe('GitService.commitAll', () => {
  it('uses execFile with argument array', async () => {
    const commandService: any = {};
    const fs: any = {};
    const git = new GitService(commandService, fs);
    const execFile = (execFileCb as unknown as jest.Mock);

    await git.commitAll('/repo', 'msg');

    expect(execFile).toHaveBeenCalledTimes(1);
    const call = execFile.mock.calls[0];
    expect(call[0]).toBe('git');
    expect(call[1]).toEqual(['commit', '-m', 'msg']);
    expect(call[2]).toEqual({ cwd: '/repo' });
    expect(typeof call[3]).toBe('function');
  });
});