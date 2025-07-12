import path from 'path';
import fsPromises from 'fs/promises';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';

/**
 * Helper for JSONL files: listing, reading, and appending newline-delimited JSON entries.
 */
export class JsonlFile {
  constructor(private fs: FileSystem, private filePath: string) {}

  /**
   * Lists the basenames of .jsonl files in the given directory.
   */
  async list(): Promise<string[]> {
    await this.fs.ensureDirExists(this.filePath);
    try {
      const entries = await fsPromises.readdir(this.filePath);
      return entries.filter(f => f.endsWith('.jsonl')).map(f => path.basename(f, '.jsonl'));
    } catch (err) {
      console.error(chalk.red(`Error listing files in ${this.filePath}:`), err);
      return [];
    }
  }

  /**
   * Reads and parses all JSON objects from a .jsonl file. Returns an empty array if missing.
   */
  async read(): Promise<any[]> {
    try {
      await fsPromises.access(this.filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      console.error(`Error accessing file ${this.filePath} for reading:`, err);
      throw err;
    }
    try {
      const content = await this.fs.readFile(this.filePath);
      if (!content?.trim()) return [];
      return content.trim().split('\n').map(line => JSON.parse(line));
    } catch (err) {
      console.error(`Error reading or parsing JSONL file ${this.filePath}:`, err);
      throw new Error(`Failed to parse ${this.filePath}. Check its format.`);
    }
  }

  /**
   * Appends a JSON object as a newline-delimited entry to the file, creating directories as needed.
   */
  async append(data: object): Promise<void> {
    const entry = JSON.stringify(data) + '\n';
    try {
      const dir = path.dirname(this.filePath);
      await this.fs.ensureDirExists(dir);
      await fsPromises.appendFile(this.filePath, entry, 'utf-8');
    } catch (err) {
      console.error(`Error appending to JSONL file ${this.filePath}:`, err);
      throw err;
    }
  }
}