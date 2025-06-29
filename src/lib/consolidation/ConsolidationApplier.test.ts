import { ConsolidationApplier } from './ConsolidationApplier'; // Adjust path if necessary
import { FileSystem } from '../FileSystem'; // Import FileSystem
import { FinalFileStates } from './types'; // Import FinalFileStates

// Mock FileSystem
jest.mock('../FileSystem');

// Suppress console output for cleaner test runs
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

describe('ConsolidationApplier', () => {
  let applier: ConsolidationApplier;
  let mockFs: jest.Mocked<FileSystem>;
  const projectRoot = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs = new FileSystem() as jest.Mocked<FileSystem>;
    // Mock the internal methods that applier uses
    mockFs.access.mockResolvedValue(undefined); // File exists for deletion
    mockFs.deleteFile.mockResolvedValue(undefined);
    mockFs.ensureDirExists.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    applier = new ConsolidationApplier(mockFs);
  });

  it('should be defined', () => {
    expect(applier).toBeDefined();
  });

  it('should return counts of applied operations when applying consolidation to an empty object', async () => {
    const finalStates: FinalFileStates = {};
    const result = await applier.apply(finalStates, projectRoot);
    expect(result).toEqual({ success: 0, failed: 0, skipped: 0, summary: [] });
  });

  it('should apply changes based on FinalFileStates and return summary', async () => {
    const finalStates: FinalFileStates = {
      'src/fileA.ts': 'console.log("hello");',
      'README.md': 'DELETE_CONFIRMED',
      'src/components/new.tsx': 'export const newComp = () => <div/>;',
    };

    const result = await applier.apply(finalStates, projectRoot);

    expect(result.success).toBe(3); // Two files written + one file deleted successfully
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.summary.length).toBe(3); // One message per operation
    expect(mockFs.writeFile).toHaveBeenCalledTimes(2); // Two writes
    expect(mockFs.deleteFile).toHaveBeenCalledTimes(1); // One delete
  });

  it('should skip deletion if a file no longer exists', async () => {
    const enoent = Object.assign(new Error('no'), { code: 'ENOENT' });
    mockFs.access.mockRejectedValueOnce(enoent);
    const finalStates: FinalFileStates = { 'gone.txt': 'DELETE_CONFIRMED' };

    const result = await applier.apply(finalStates, projectRoot);

    expect(result).toEqual({ success: 0, failed: 0, skipped: 1, summary: [expect.stringContaining('Skipped delete')] });
    expect(mockFs.deleteFile).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('should handle delete errors', async () => {
    const err = Object.assign(new Error('denied'), { code: 'EACCES' });
    mockFs.access.mockRejectedValueOnce(err);
    const finalStates: FinalFileStates = { 'bad.txt': 'DELETE_CONFIRMED' };

    const result = await applier.apply(finalStates, projectRoot);

    expect(result.failed).toBe(1);
    expect(result.success).toBe(0);
    expect(mockFs.deleteFile).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('should handle write errors', async () => {
    mockFs.writeFile.mockRejectedValueOnce(new Error('boom'));
    const finalStates: FinalFileStates = { 'a.ts': 'x' };

    const result = await applier.apply(finalStates, projectRoot);

    expect(result.failed).toBe(1);
    expect(result.success).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it('should treat non-string content as empty on write', async () => {
    const result = await (applier as any)._applyOperationToFile('weird.txt', 123 as any, projectRoot);
    expect(result.status).toBe('success');
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.any(String), '');
  });
});