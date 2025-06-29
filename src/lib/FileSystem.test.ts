import mockFs from 'mock-fs';
import path from 'path';
import { FileSystem } from './FileSystem';

describe('FileSystem synchronous helpers', () => {
  const testDir = '/tmp/test-dir';
  const testFile = path.join(testDir, 'file.txt');
  const binaryFile = path.join(testDir, 'bin.bin');
  const subDir = path.join(testDir, 'sub');
  const fileInNewDir = path.join(subDir, 'new.txt');
  const nonExistentPath = path.join(testDir, 'missing.txt');
  const nonEmptyDir = path.join(testDir, 'nonempty');

  beforeEach(() => {
    mockFs({
      [testDir]: {
        'file.txt': 'Hello, World!',
        'bin.bin': Buffer.from([1, 2, 3]),
        'existing-dir': {},
        'nonempty': { 'a.txt': 'data' },
      },
    });
  });

  afterEach(() => {
    mockFs.restore();
  });

  it('existsSync checks files and directories', () => {
    expect(FileSystem.existsSync(testFile)).toBe(true);
    expect(FileSystem.existsSync(testDir)).toBe(true);
    expect(FileSystem.existsSync(nonExistentPath)).toBe(false);
  });

  it('readFileSync reads and errors appropriately', () => {
    expect(FileSystem.readFileSync(testFile)).toBe('Hello, World!');
    expect(() => FileSystem.readFileSync(nonExistentPath)).toThrow();
    expect(FileSystem.readFileSync(binaryFile, 'latin1')).toBe('\x01\x02\x03');
    expect(() => FileSystem.readFileSync(testDir)).toThrow();
  });

  it('writeFileSync writes files and directories', () => {
    const newFile = path.join(testDir, 'new.txt');
    FileSystem.writeFileSync(newFile, 'New content');
    expect(FileSystem.existsSync(newFile)).toBe(true);
    expect(FileSystem.readFileSync(newFile)).toBe('New content');

    FileSystem.writeFileSync(testFile, 'Overwritten content');
    expect(FileSystem.readFileSync(testFile)).toBe('Overwritten content');

    FileSystem.writeFileSync(fileInNewDir, 'Content in new dir');
    expect(FileSystem.existsSync(subDir)).toBe(true);
    expect(FileSystem.readFileSync(fileInNewDir)).toBe('Content in new dir');

    expect(() => FileSystem.writeFileSync(testDir, 'some content')).toThrow();
  });

  it('mkdirSync behaves like fs.mkdirSync', () => {
    FileSystem.mkdirSync(subDir);
    expect(FileSystem.existsSync(subDir)).toBe(true);
    expect(() => FileSystem.mkdirSync(testFile)).toThrow();
    expect(() => FileSystem.mkdirSync(testDir)).not.toThrow();
    expect(FileSystem.existsSync(testDir)).toBe(true);
  });

  it('rmSync removes files and directories', () => {
    FileSystem.rmSync(testFile);
    expect(FileSystem.existsSync(testFile)).toBe(false);

    FileSystem.rmSync(path.join(testDir, 'existing-dir'), { recursive: true });
    expect(FileSystem.existsSync(path.join(testDir, 'existing-dir'))).toBe(false);

    expect(() => FileSystem.rmSync(nonExistentPath)).toThrow();
    expect(() => FileSystem.rmSync(nonExistentPath, { force: true })).not.toThrow();

    expect(() => FileSystem.rmSync(nonEmptyDir)).toThrow();
    expect(FileSystem.existsSync(nonEmptyDir)).toBe(true);
  });
});
