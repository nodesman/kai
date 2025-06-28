import { GitService } from '../GitService';
import { execFile as execFileCb } from 'child_process';

// Chalk is ESM-only which Jest struggles to load in the CommonJS test environment
// so we provide a simple manual mock that returns proxy functions.
jest.mock('chalk');

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

// Suppress console output during tests
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

describe('GitService.isGitRepository', () => {
    it('returns true when inside a git repository', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: 'true\n', stderr: '' });
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.isGitRepository('/repo')).resolves.toBe(true);
        expect(run).toHaveBeenCalledWith('git rev-parse --is-inside-work-tree', { cwd: '/repo' });
    });

    it('returns false when not a git repository', async () => {
        const err = { stderr: 'not a git repository', code: 128 };
        const run = jest.fn().mockRejectedValue(err);
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.isGitRepository('/repo')).resolves.toBe(false);
    });

    it('throws an error when git command is not found', async () => {
        const err: any = new Error('missing'); err.code = 'ENOENT';
        const run = jest.fn().mockRejectedValue(err);
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.isGitRepository('/repo')).rejects.toThrow('Git command not found');
    });
});
describe('GitService.initializeRepository', () => {
    it('initializes a new repository successfully', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.initializeRepository('/repo')).resolves.toBeUndefined();
        expect(run).toHaveBeenCalledWith('git init', { cwd: '/repo' });
    });

    it('throws error when git init fails', async () => {
        const err: any = new Error('fail'); err.code = 'ENOENT';
        const run = jest.fn().mockRejectedValue(err);
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.initializeRepository('/repo')).rejects.toThrow('Failed to initialize Git');
    });
});
describe('GitService.checkCleanStatus', () => {
    it('does nothing when working directory is clean', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.checkCleanStatus('/repo')).resolves.toBeUndefined();
    });

    it('throws when working directory is not clean', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: ' M file.js', stderr: '' });
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.checkCleanStatus('/repo')).rejects.toThrow('Git working directory not clean');
    });
});
describe('GitService.listModifiedFiles', () => {
    it('returns list of modified files from git status output', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: ' M a.js\nA  b.txt\n', stderr: '' });
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.listModifiedFiles('/repo')).resolves.toEqual(['a.js', 'b.txt']);
    });
});
describe('GitService.getDiff', () => {
    it('returns diff output', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: 'diff text', stderr: '' });
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.getDiff('/repo')).resolves.toBe('diff text');
    });
});
describe('GitService.stageAllChanges', () => {
    it('stages all changes successfully', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
        const svc = new GitService({ run } as any, {} as any);
        await expect(svc.stageAllChanges('/repo')).resolves.toBeUndefined();
        expect(run).toHaveBeenCalledWith('git add -A', { cwd: '/repo' });
    });
});
describe('GitService.ensureGitignoreRules', () => {
    it('creates .gitignore with kai rule if missing', async () => {
        const mockFs: any = { readFile: jest.fn().mockResolvedValue(null), writeFile: jest.fn().mockResolvedValue(undefined) };
        const svc = new GitService({ run: jest.fn() } as any, mockFs);
        await svc.ensureGitignoreRules('/proj');
        expect(mockFs.writeFile).toHaveBeenCalledWith(
            '/proj/.gitignore',
            expect.stringContaining('.kai/')
        );
    });

    it('appends kai rule if not present in existing .gitignore', async () => {
        const existing = 'node_modules/';
        const mockFs: any = {
            readFile: jest.fn().mockResolvedValue(existing),
            writeFile: jest.fn().mockResolvedValue(undefined)
        };
        const svc = new GitService({ run: jest.fn() } as any, mockFs);
        await svc.ensureGitignoreRules('/proj');
        expect(mockFs.writeFile).toHaveBeenCalledWith(
            '/proj/.gitignore',
            expect.stringContaining('.kai/')
        );
    });
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