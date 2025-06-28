jest.resetModules();
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

import { exec } from 'child_process';
import { CommandService } from '../CommandService';

const mockedExec = exec as unknown as jest.Mock;

describe('CommandService', () => {
  let service: CommandService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new CommandService();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('run()', () => {
    it('executes a command successfully with no stderr', async () => {
      mockedExec.mockImplementation((cmd, opts, cb) => cb(null, 'out\n', ''));
      const result = await service.run('echo hello', { cwd: '/cwd' });
      expect(result).toEqual({ stdout: 'out\n', stderr: '' });
      expect(mockedExec).toHaveBeenCalledWith('echo hello', { cwd: '/cwd' }, expect.any(Function));
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🔩 Executing command: echo hello in /cwd'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🔩 Command stdout:\nout'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('👍 Command executed successfully: echo hello'));
    });

    it('logs a warning when stderr is present', async () => {
      mockedExec.mockImplementation((cmd, opts, cb) => cb(null, 'ok\n', 'warn\n'));
      const result = await service.run('cmd', {});
      expect(result).toEqual({ stdout: 'ok\n', stderr: 'warn\n' });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('🔩 Command stderr:\nwarn'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🔩 Command stdout:\nok'));
    });

    it('redacts GEMINI_API_KEY from the executed command', async () => {
      mockedExec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));
      await service.run('use-key 123', { env: { GEMINI_API_KEY: '123' } });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🔩 Executing command: use-key ***'));
    });

    it('throws and logs errors on non-zero exit', async () => {
      const err = new Error('failure') as any;
      err.code = 1;
      err.stdout = 'so\n';
      err.stderr = 'se\n';
      mockedExec.mockImplementation((cmd, opts, cb) => cb(err, err.stdout, err.stderr));
      await expect(service.run('bad', {})).rejects.toBe(err);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('🔥 Command failed: bad'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Exit Code: 1'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('   Stderr:\nse'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('   Stdout (on failure):\nso'));
    });

    it('throws and logs errors when command not found', async () => {
      const err = new Error('not found') as any;
      delete err.code;
      err.message = 'spawn ENOENT';
      mockedExec.mockImplementation((cmd, opts, cb) => cb(err, null, null));
      await expect(service.run('missing', {})).rejects.toBe(err);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('🔥 Command failed: missing'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error Message: spawn ENOENT'));
    });
  });
});