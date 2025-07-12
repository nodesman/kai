import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileSystem } from './FileSystem';
import { JsonlFile } from './JsonlFile';

describe('JsonlFile', () => {
  let tmpDir: string;
  let fsUtil: FileSystem;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-'));
    fsUtil = new FileSystem();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists entries in an existing directory', async () => {
    const logsDir = path.join(tmpDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'one.jsonl'), '');
    fs.writeFileSync(path.join(logsDir, 'two.txt'), '');
    fs.writeFileSync(path.join(logsDir, 'three.jsonl'), '');
    const jsonl = new JsonlFile(fsUtil, logsDir);
    const list = await jsonl.list();
    expect(list.sort()).toEqual(['one', 'three']);
  });

  it('returns empty list for non-existent directory', async () => {
    const nonExist = path.join(tmpDir, 'empty');
    const jsonl = new JsonlFile(fsUtil, nonExist);
    const list = await jsonl.list();
    expect(list).toEqual([]);
  });

  it('appends and reads entries', async () => {
    const file = path.join(tmpDir, 'data.jsonl');
    const jsonl = new JsonlFile(fsUtil, file);
    await jsonl.append({ a: 1 });
    await jsonl.append({ b: 2 });
    const entries = await jsonl.read();
    expect(entries).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('read returns empty array when file does not exist', async () => {
    const file = path.join(tmpDir, 'nonexistent.jsonl');
    const jsonl = new JsonlFile(fsUtil, file);
    const entries = await jsonl.read();
    expect(entries).toEqual([]);
  });

  it('throws on invalid JSONL format', async () => {
    const file = path.join(tmpDir, 'bad.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'not json\n');
    const jsonl = new JsonlFile(fsUtil, file);
    await expect(jsonl.read()).rejects.toThrow(
      `Failed to parse ${file}. Check its format.`
    );
  });
});