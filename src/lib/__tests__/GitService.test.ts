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

describe('GitService error branches', () => {
  let run: jest.Mock;
  let svc: GitService;

  beforeEach(() => {
    run = jest.fn();
    svc = new GitService({ run } as any, {} as any);
  });

  it('listModifiedFiles rejects on git status error', async () => {
    run.mockRejectedValue(new Error('fail-status'));
    await expect(svc.listModifiedFiles('/repo')).rejects.toThrow('fail-status');
  });

  it('getDiff rejects on git diff error', async () => {
    run.mockRejectedValue(new Error('fail-diff'));
    await expect(svc.getDiff('/repo')).rejects.toThrow('fail-diff');
  });

  it('stageAllChanges rejects on git add failure', async () => {
    run.mockRejectedValue(new Error('fail-add'));
    await expect(svc.stageAllChanges('/repo')).rejects.toThrow('fail-add');
  });

  it('checkCleanStatus throws on unexpected error code', async () => {
    run.mockResolvedValue({ stdout: ' M foo', stderr: '' });
    await expect(svc.checkCleanStatus('/repo')).rejects.toThrow('Git working directory not clean');
  });
});
describe('GitService.getIgnoreRules', () => {
  it('returns defaults when no .gitignore or .kaiignore exist', async () => {
    const mockFs: any = { readFile: jest.fn().mockResolvedValue(null) };
    const svc = new GitService({ run: jest.fn() } as any, mockFs);
    const ig = await svc.getIgnoreRules('/proj');
    expect(mockFs.readFile).toHaveBeenCalledWith('/proj/.gitignore');
    expect(mockFs.readFile).toHaveBeenCalledWith('/proj/.kaiignore');
    expect(ig.ignores('.git')).toBe(true);
    expect(ig.ignores('.kai/somefile')).toBe(true);
    expect(ig.ignores('other.txt')).toBe(false);
  });

  it('applies rules from .gitignore and .kaiignore', async () => {
    const gitignore = 'foo/\nbar.js';
    const kaiignore = 'baz/\n';
    const mockFs: any = {
      readFile: jest.fn().mockImplementation((p: string) =>
        p.endsWith('.gitignore') ? Promise.resolve(gitignore) : Promise.resolve(kaiignore)
      ),
    };
    const svc = new GitService({ run: jest.fn() } as any, mockFs);
    const ig = await svc.getIgnoreRules('/proj');
    expect(ig.ignores('foo/file.txt')).toBe(true);
    expect(ig.ignores('bar.js')).toBe(true);
    expect(ig.ignores('baz/x')).toBe(true);
    expect(ig.ignores('keep.me')).toBe(false);
  });
});

describe('GitService.createAnnotatedTag', () => {
  let svc: GitService;
  let runMock: jest.Mock;

  beforeEach(() => {
    runMock = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    svc = new GitService({ run: runMock } as any, {} as any);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws for invalid tag names', async () => {
    await expect(svc.createAnnotatedTag('/proj', '', 'msg')).rejects.toThrow(/Invalid tag name/);
    await expect(svc.createAnnotatedTag('/proj', 'bad tag', 'msg')).rejects.toThrow(/Invalid tag name/);
  });

  it('creates a tag on success', async () => {
    await expect(svc.createAnnotatedTag('/proj', 'v1.0.0', 'release')).resolves.toBeUndefined();
    expect(runMock).toHaveBeenCalledWith(
      'git tag -a "v1.0.0" -m "release"',
      { cwd: '/proj' }
    );
  });

  it('handles ENOENT (git not found)', async () => {
    const err: any = new Error('no git'); err.code = 'ENOENT';
    runMock.mockRejectedValueOnce(err);
    await expect(svc.createAnnotatedTag('/proj', 'v1', 'm')).rejects.toThrow(/Ensure Git is installed/);
  });

  it('handles existing tag stderr', async () => {
    const err: any = new Error('exists'); err.stderr = 'fatal: tag already exists'; err.code = 0;
    runMock.mockRejectedValueOnce(err);
    await expect(svc.createAnnotatedTag('/proj', 'v1', 'm')).rejects.toThrow(/Tag 'v1' already exists/);
  });

  it('handles other stderr cases', async () => {
    const err: any = new Error('oops'); err.stderr = 'some error'; err.code = 2;
    runMock.mockRejectedValueOnce(err);
    await expect(svc.createAnnotatedTag('/proj', 'v2', 'm')).rejects.toThrow(/Stderr: some error/);
  });

  it('handles other exit codes', async () => {
    const err: any = new Error('oops2'); err.code = 5;
    runMock.mockRejectedValueOnce(err);
    await expect(svc.createAnnotatedTag('/proj', 'v3', 'm')).rejects.toThrow(/Exit Code: 5/);
  });

  it('handles generic errors without code', async () => {
    runMock.mockRejectedValueOnce(new Error('bad'));
    await expect(svc.createAnnotatedTag('/proj', 'v4', 'm')).rejects.toThrow('Failed to create Git tag');
  });

  it('handles missing error message', async () => {
    const err: any = { code: 1 };
    runMock.mockRejectedValueOnce(err);
    await expect(svc.createAnnotatedTag('/proj', 'v5', 'm')).rejects.toThrow('Unknown error');
  });
});

// Additional branch coverage tests
describe('GitService additional branches', () => {
  beforeEach(() => {
    (console.warn as jest.Mock).mockClear();
    (console.error as jest.Mock).mockClear();
  });

  it('getRepositoryRoot falls back on error', async () => {
    const run = jest.fn().mockRejectedValue(new Error('fail'));
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.getRepositoryRoot('/cwd')).resolves.toBe('/cwd');
  });

  it('getRepositoryRoot returns path on success', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '/repo\n' });
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.getRepositoryRoot('/cwd')).resolves.toBe('/repo');
  });

  it('isGitRepository throws generic error', async () => {
    const err: any = new Error('oops');
    err.code = 1;
    err.stderr = 'err';
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.isGitRepository('/repo')).rejects.toThrow('Failed to verify Git repository status');
  });

  it('isGitRepository handles error without code', async () => {
    const err = new Error('oops');
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.isGitRepository('/repo')).rejects.toThrow('Failed to verify Git repository status');
  });

  it('isGitRepository handles code zero', async () => {
    const err: any = new Error('fail');
    err.code = 0;
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.isGitRepository('/repo')).rejects.toThrow('Failed to verify Git repository status');
  });

  it('isGitRepository handles command-not-found message', async () => {
    const err: any = new Error('command not found');
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.isGitRepository('/repo')).rejects.toThrow('Git command not found');
  });

  it('initializeRepository includes stderr in error', async () => {
    const err: any = new Error('bad');
    err.stderr = 'whoops';
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.initializeRepository('/r')).rejects.toThrow('Stderr: whoops');
  });

  it('initializeRepository includes exit code', async () => {
    const err: any = new Error('bad');
    err.code = 2;
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.initializeRepository('/r')).rejects.toThrow('Exit Code: 2');
  });

  it('initializeRepository handles generic error', async () => {
    const run = jest.fn().mockRejectedValue(new Error('fail'));
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.initializeRepository('/r')).rejects.toThrow('Failed to initialize Git repository');
  });

  it('initializeRepository handles command-not-found message', async () => {
    const err: any = new Error('command not found');
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.initializeRepository('/r')).rejects.toThrow('Please ensure Git is installed');
  });

  it('initializeRepository handles missing message', async () => {
    const err: any = { stderr: 'oops' };
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.initializeRepository('/r')).rejects.toThrow('Stderr: oops');
  });

  it('ensureGitRepository warns and calls isGitRepository', async () => {
    const svc = new GitService({ run: jest.fn() } as any, {} as any);
    const spy = jest.spyOn(svc, 'isGitRepository').mockResolvedValue(true);
    await svc.ensureGitRepository('/r');
    expect(spy).toHaveBeenCalledWith('/r');
    spy.mockRestore();
  });

  it('checkCleanStatus warns on clean stderr', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: 'noise' });
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.checkCleanStatus('/r')).resolves.toBeUndefined();
    expect((console.warn as jest.Mock)).toHaveBeenCalled();
  });

  it('checkCleanStatus handles git not found', async () => {
    const err: any = new Error('missing');
    err.code = 'ENOENT';
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.checkCleanStatus('/r')).rejects.toThrow('Git command not found');
  });

  it('checkCleanStatus handles not a repo', async () => {
    const err: any = new Error('bad');
    err.stderr = 'not a git repository';
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.checkCleanStatus('/r')).rejects.toThrow('not a Git repository');
  });

  it('checkCleanStatus handles generic error with code', async () => {
    const err: any = new Error('oops');
    err.code = 3;
    err.stderr = 'boom';
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.checkCleanStatus('/r')).rejects.toThrow('Exit Code: 3');
  });

  it('checkCleanStatus handles generic error without code', async () => {
    const run = jest.fn().mockRejectedValue(new Error('x'));
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.checkCleanStatus('/r')).rejects.toThrow('Failed to verify Git status');
  });

  it('checkCleanStatus handles missing message', async () => {
    const err: any = { stderr: '' };
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.checkCleanStatus('/r')).rejects.toThrow('Unknown error');
  });

  it('checkCleanStatus handles code zero', async () => {
    const err: any = new Error('zero');
    err.code = 0;
    const run = jest.fn().mockRejectedValue(err);
    const svc = new GitService({ run } as any, {} as any);
    await expect(svc.checkCleanStatus('/r')).rejects.toThrow('Failed to verify Git status');
  });

  it('ensureGitignoreRules skips when rule already exists', async () => {
    const content = '# Kai internal files (logs, cache, config) - (auto-added by Kai)\n.kai/\n';
    const mockFs: any = { readFile: jest.fn().mockResolvedValue(content), writeFile: jest.fn() };
    const svc = new GitService({ run: jest.fn() } as any, mockFs);
    await svc.ensureGitignoreRules('/p');
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('ensureGitignoreRules logs write errors', async () => {
    const mockFs: any = {
      readFile: jest.fn().mockResolvedValue(null),
      writeFile: jest.fn().mockRejectedValue(new Error('fail')),
    };
    const svc = new GitService({ run: jest.fn() } as any, mockFs);
    await svc.ensureGitignoreRules('/p');
    expect(mockFs.writeFile).toHaveBeenCalled();
    expect((console.error as jest.Mock)).toHaveBeenCalled();
  });

  it('ensureGitignoreRules logs append errors and handles newline', async () => {
    const mockFs: any = {
      readFile: jest
        .fn()
        .mockResolvedValueOnce('node_modules/\n')
        .mockResolvedValueOnce(null),
      writeFile: jest.fn().mockRejectedValue(new Error('appendFail')),
    };
    const svc = new GitService({ run: jest.fn() } as any, mockFs);
    await svc.ensureGitignoreRules('/p');
    expect(mockFs.writeFile).toHaveBeenCalled();
    expect((console.error as jest.Mock)).toHaveBeenCalled();
  });

  it('ensureGitignoreRules handles readFile error', async () => {
    const mockFs: any = { readFile: jest.fn().mockRejectedValue(new Error('oops')), writeFile: jest.fn() };
    const svc = new GitService({ run: jest.fn() } as any, mockFs);
    await svc.ensureGitignoreRules('/p');
    expect((console.error as jest.Mock)).toHaveBeenCalled();
  });

  it('getIgnoreRules handles read errors', async () => {
    const fsMock: any = {
      readFile: jest.fn().mockRejectedValueOnce(new Error('giterr')).mockRejectedValueOnce(new Error('kaierr')),
    };
    const svc = new GitService({ run: jest.fn() } as any, fsMock);
    const ig = await svc.getIgnoreRules('/root');
    expect(fsMock.readFile).toHaveBeenCalledTimes(2);
    expect(ig.ignores('.kai/file')).toBe(true);
  });
});