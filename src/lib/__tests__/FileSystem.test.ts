
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { FileSystem } from '../FileSystem';

describe('FileSystem', () => {
  let tempDir: string;
  let fsUtil: FileSystem;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(__dirname, 'fs-test-'));
    fsUtil = new FileSystem();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes and reads a file', async () => {
    const filePath = path.join(tempDir, 'sub', 'file.txt');
    await fsUtil.writeFile(filePath, 'hello');
    const content = await fsUtil.readFile(filePath);
    expect(content).toBe('hello');
  });

  it('readFile returns null for missing file and stat returns null', async () => {
    const missing = path.join(tempDir, 'nope.txt');
    expect(await fsUtil.readFile(missing)).toBeNull();
    expect(await fsUtil.stat(missing)).toBeNull();
  });

  it('isDirectoryEmptyOrSafe handles non-existent, safe-only, and unsafe dirs', async () => {
    // non-existent dir
    const dirA = path.join(tempDir, 'A');
    expect(await fsUtil.isDirectoryEmptyOrSafe(dirA)).toBe(true);
    // safe-only dir (.DS_Store)
    const dirB = path.join(tempDir, 'B');
    fs.mkdirSync(dirB);
    fs.writeFileSync(path.join(dirB, '.DS_Store'), '');
    expect(await fsUtil.isDirectoryEmptyOrSafe(dirB)).toBe(true);
    // unsafe dir (contains other file)
    const dirC = path.join(tempDir, 'C');
    fs.mkdirSync(dirC);
    fs.writeFileSync(path.join(dirC, 'foo.txt'), '');
    expect(await fsUtil.isDirectoryEmptyOrSafe(dirC)).toBe(false);
  });

  it('ensureDirExists creates nested directories', async () => {
    const nested = path.join(tempDir, 'x', 'y', 'z');
    await fsUtil.ensureDirExists(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('listJsonlFiles lists only .jsonl basenames', async () => {
    const dir = path.join(tempDir, 'logs');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'one.jsonl'), '');
    fs.writeFileSync(path.join(dir, 'two.txt'), '');
    fs.writeFileSync(path.join(dir, 'three.jsonl'), '');
    const list = await fsUtil.listJsonlFiles(dir);
    expect(list.sort()).toEqual(['one', 'three']);
  });

  it('readFileContents returns map for existing files only', async () => {
    const f1 = path.join(tempDir, 'a.txt');
    const f2 = path.join(tempDir, 'b.txt');
    fs.writeFileSync(f1, 'A');
    const map = await fsUtil.readFileContents([f1, f2]);
    expect(map).toEqual({ [f1]: 'A' });
  });

  it('isTextFile detects text vs binary', async () => {
    const textPath = path.join(tempDir, 't.txt');
    const binPath = path.join(tempDir, 'b.bin');
    fs.writeFileSync(textPath, 'hello');
    fs.writeFileSync(binPath, Buffer.from([0, 1, 2, 3, 0]));
    expect(await fsUtil.isTextFile(textPath)).toBe(true);
    expect(await fsUtil.isTextFile(binPath)).toBe(false);
  });

  describe('applyDiffToFile', () => {
    afterEach(() => {
      const logDir = path.join(tempDir, '.kai');
      if (fs.existsSync(logDir)) {
        fs.rmSync(logDir, { recursive: true, force: true });
      }
    });
    it('applies patch to modify file', async () => {
      const filePath = path.join(tempDir, 'a.txt');
      fs.writeFileSync(filePath, 'hello\n');
      const diff = require('diff').createTwoFilesPatch('a.txt', 'a.txt', 'hello\n', 'hi\n');
      const result = await fsUtil.applyDiffToFile(filePath, diff);
      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('hi\n');
    });

    it('creates a new file from patch', async () => {
      const filePath = path.join(tempDir, 'new.txt');
      const diff = require('diff').createTwoFilesPatch('/dev/null', 'new.txt', '', 'newfile\n');
      const result = await fsUtil.applyDiffToFile(filePath, diff);
      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('newfile\n');
    });

    it('creates a new file when diff is wrapped in fences', async () => {
      const filePath = path.join(tempDir, 'fenced.txt');
      const diff = require('diff').createTwoFilesPatch('/dev/null', 'fenced.txt', '', 'hello\n');
      const fenced = '```diff\n' + diff.trim() + '\n```';
      const result = await fsUtil.applyDiffToFile(filePath, fenced);
      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('hello\n');
    });

    it('deletes a file from patch', async () => {
      const filePath = path.join(tempDir, 'del.txt');
      fs.writeFileSync(filePath, 'remove\n');
      const diff = require('diff').createTwoFilesPatch('del.txt', '/dev/null', 'remove\n', '');
      const result = await fsUtil.applyDiffToFile(filePath, diff);
      expect(result).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('applies patch when diff is wrapped in fences', async () => {
      const filePath = path.join(tempDir, 'wrap.txt');
      fs.writeFileSync(filePath, 'a\n');
      const raw = require('diff').createTwoFilesPatch('wrap.txt', 'wrap.txt', 'a\n', 'b\n');
      const fenced = '```diff\n' + raw.trim() + '\n```';
      const result = await fsUtil.applyDiffToFile(filePath, fenced);
      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('b\n');
    });

    it('returns false when patch fails', async () => {
      const cwd = process.cwd();
      process.chdir(tempDir);
      try {
        const filePath = path.join(tempDir, 'fail.txt');
        fs.writeFileSync(filePath, 'original\n');
        const base = require('diff').createTwoFilesPatch('fail.txt', 'fail.txt', 'hello\n', 'hi\n');
        const fenced = '```diff\n' + base.trim() + '\n```';
        const result = await fsUtil.applyDiffToFile(filePath, fenced);
        expect(result).toBe(false);

        const logFile = path.join(tempDir, '.kai/logs/diff_failures.jsonl');
        expect(fs.existsSync(logFile)).toBe(true);
        const line = fs.readFileSync(logFile, 'utf8').trim().split('\n')[0];
        const entry = JSON.parse(line);
        expect(entry.file).toBe(filePath);
        expect(entry.diff.includes('```')).toBe(false);
      } finally {
        process.chdir(cwd);
      }
    });

    it('logs failure when patch fails', async () => {
      const filePath = path.join(tempDir, 'logfail.txt');
      fs.writeFileSync(filePath, 'orig\n');
      const diff = require('diff').createTwoFilesPatch('logfail.txt', 'logfail.txt', 'a\n', 'b\n');
      const spyAppend = jest.spyOn(fsUtil, 'appendJsonlFile').mockResolvedValue();
      const spyEnsure = jest.spyOn(fsUtil, 'ensureDirExists').mockResolvedValue();
      const result = await fsUtil.applyDiffToFile(filePath, diff);
      expect(result).toBe(false);
      const logPath = path.join(path.resolve('.kai/logs'), 'diff_failures.jsonl');
      expect(spyEnsure).toHaveBeenCalledWith(path.resolve('.kai/logs'));
      expect(spyAppend).toHaveBeenCalledWith(logPath, expect.objectContaining({ file: filePath }));
    });

    it('logs failure when no patch data', async () => {
      const spyAppend = jest.spyOn(fsUtil, 'appendJsonlFile').mockResolvedValue();
      const spyEnsure = jest.spyOn(fsUtil, 'ensureDirExists').mockResolvedValue();
      const badDiff = '--- a\n+++ b\n@@\n';
      const result = await fsUtil.applyDiffToFile(path.join(tempDir, 'none.txt'), badDiff);
      expect(result).toBe(false);
      expect(spyEnsure).toHaveBeenCalled();
      expect(spyAppend).toHaveBeenCalled();
    });
  });

  describe('error and edge cases', () => {
    const spyErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('rethrows non-ENOENT in readFile', async () => {
      jest.spyOn(fsPromises, 'readFile').mockRejectedValue({ code: 'EACCES', message: 'denied' });
      await expect(fsUtil.readFile('/no')).rejects.toMatchObject({ code: 'EACCES' });
    });

    it('rethrows non-ENOENT in stat', async () => {
      jest.spyOn(fsPromises, 'stat').mockRejectedValue({ code: 'EACCES', message: 'denied' });
      await expect(fsUtil.stat('/no')).rejects.toMatchObject({ code: 'EACCES' });
    });

    it('rethrows non-ENOENT in isDirectoryEmptyOrSafe', async () => {
      jest.spyOn(fsPromises, 'readdir').mockRejectedValue({ code: 'EACCES', message: 'denied' });
      await expect(fsUtil.isDirectoryEmptyOrSafe('/no')).rejects.toMatchObject({ code: 'EACCES' });
    });

    it('rethrows non-ENOENT in ensureDirExists.access', async () => {
      jest.spyOn(fsPromises, 'access').mockRejectedValue({ code: 'EACCES', message: 'denied' });
      await expect(fsUtil.ensureDirExists('/no')).rejects.toMatchObject({ code: 'EACCES' });
    });

    it('getProjectFiles requires ignore rules', async () => {
      await expect(fsUtil.getProjectFiles(__dirname as any)).rejects.toThrow(/requires an Ignore object/);
    });

    it('assumes text when isTextFile open/read fails', async () => {
      jest.spyOn(fsPromises, 'open' as any).mockRejectedValue({ message: 'fail' });
      expect(await fsUtil.isTextFile('any')).toBe(true);
    });

    it('propagates error when ensureDirExists fails', async () => {
      jest.spyOn(fsUtil, 'ensureDirExists').mockRejectedValue(new Error('fail'));
      await expect(fsUtil.listJsonlFiles('/no')).rejects.toThrow('fail');
    });

    describe('readJsonlFile', () => {
      const tmp = path.join(__dirname, 'tmp-jsonl');
      const file = path.join(tmp, 'a.jsonl');
      beforeAll(() => fs.mkdirSync(tmp, { recursive: true }));
      afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

      it('returns [] when file missing', async () => {
        await expect(fsUtil.readJsonlFile(file)).resolves.toEqual([]);
      });

      it('returns [] when empty file', async () => {
        fs.writeFileSync(file, '');
        await expect(fsUtil.readJsonlFile(file)).resolves.toEqual([]);
      });

      it('parses JSON lines', async () => {
        fs.writeFileSync(file, JSON.stringify({ x: 1 }) + '\n' + JSON.stringify({ x: 2 }) + '\n');
        await expect(fsUtil.readJsonlFile(file)).resolves.toEqual([{ x: 1 }, { x: 2 }]);
      });

      it('throws on invalid JSON', async () => {
        fs.writeFileSync(file, '{bad json}\n');
        await expect(fsUtil.readJsonlFile(file)).rejects.toThrow(/Failed to parse/);
      });
    });

    describe('appendJsonlFile', () => {
      const tmpf = path.join(__dirname, 'tmp-append.jsonl');
      afterEach(() => fs.existsSync(tmpf) && fs.unlinkSync(tmpf));

      it('appends entries to file', async () => {
        await fsUtil.appendJsonlFile(tmpf, { a: 1 });
        await fsUtil.appendJsonlFile(tmpf, { b: 2 });
        const lines = fs.readFileSync(tmpf, 'utf8').trim().split('\n');
        expect(lines).toEqual([JSON.stringify({ a: 1 }), JSON.stringify({ b: 2 })]);
      });

      it('throws on append error', async () => {
        jest.spyOn(fsPromises, 'appendFile').mockRejectedValue(new Error('fail'));
        await expect(fsUtil.appendJsonlFile(tmpf, {})).rejects.toThrow('fail');
      });
    });

    describe('analysis cache read/write', () => {
      const tmpc = path.join(__dirname, 'tmp-cache.json');
      afterEach(() => fs.existsSync(tmpc) && fs.unlinkSync(tmpc));

      it('readAnalysisCache returns null on missing and invalid', async () => {
        await expect(fsUtil.readAnalysisCache(tmpc)).resolves.toBeNull();
        fs.writeFileSync(tmpc, 'not json');
        await expect(fsUtil.readAnalysisCache(tmpc)).resolves.toBeNull();
      });

      it('readAnalysisCache returns null on wrong schema', async () => {
        fs.writeFileSync(tmpc, JSON.stringify({ foo: 1 }));
        await expect(fsUtil.readAnalysisCache(tmpc)).resolves.toBeNull();
      });

      it('readAnalysisCache returns valid cache', async () => {
        const data = { overallSummary: 'ok', entries: [] };
        fs.writeFileSync(tmpc, JSON.stringify(data));
        await expect(fsUtil.readAnalysisCache(tmpc)).resolves.toEqual(data);
      });

      it('writeAnalysisCache writes file', async () => {
        const cache = { overallSummary: 's', entries: [] };
        await fsUtil.writeAnalysisCache(tmpc, cache);
        const content = fs.readFileSync(tmpc, 'utf8');
        expect(JSON.parse(content)).toEqual(cache);
      });
    });
  });
});