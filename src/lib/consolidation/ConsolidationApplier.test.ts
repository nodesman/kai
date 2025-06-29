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
});