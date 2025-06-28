jest.mock('chalk');
import { FileSystem } from '../FileSystem';

describe('FileSystem', () => {
    it('reads file and returns content when file exists', async () => {
        const content = 'hello';
        jest.spyOn(require('fs/promises'), 'readFile').mockResolvedValue(content);
        const fs = new (require('../FileSystem').FileSystem)();
        await expect(fs.readFile('path.txt')).resolves.toBe(content);
    });

    it('returns null when readFile encounters ENOENT', async () => {
        const err: any = new Error('no file'); err.code = 'ENOENT';
        jest.spyOn(require('fs/promises'), 'readFile').mockRejectedValue(err);
        const fs = new (require('../FileSystem').FileSystem)();
        await expect(fs.readFile('missing.txt')).resolves.toBeNull();
    });

    it('throws error on other readFile failures', async () => {
        const err = new Error('fail');
        jest.spyOn(require('fs/promises'), 'readFile').mockRejectedValue(err);
        const fs = new (require('../FileSystem').FileSystem)();
        await expect(fs.readFile('err.txt')).rejects.toBe(err);
    });

    it('writes file content and creates directory if missing', async () => {
        const fsPromises = require('fs/promises');
        const spyMk = jest.spyOn(fsPromises, 'mkdir').mockResolvedValue(undefined);
        const spyWrite = jest.spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined);
        const fsys = new (require('../FileSystem').FileSystem)();
        jest.spyOn(fsys, 'ensureDirExists').mockResolvedValue(undefined);
        await expect(fsys.writeFile('a/b/c.txt', 'data')).resolves.toBeUndefined();
        expect(fsys.ensureDirExists).toHaveBeenCalledWith('a/b');
        expect(spyWrite).toHaveBeenCalledWith('a/b/c.txt', 'data', 'utf-8');
    });

    it('throws error when writeFile fails', async () => {
        const bad = new Error('write fail');
        const fsys = new (require('../FileSystem').FileSystem)();
        jest.spyOn(fsys, 'ensureDirExists').mockResolvedValue(undefined);
        jest.spyOn(require('fs/promises'), 'writeFile').mockRejectedValue(bad);
        await expect(fsys.writeFile('x.txt', 'd')).rejects.toBe(bad);
    });
});