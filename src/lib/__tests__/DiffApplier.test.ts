import { applyDiffIteratively } from '../DiffApplier';
import { FileSystem, DiffFailureInfo, logDiffFailure } from '../FileSystem';
import { AIClient, LogEntryData } from '../AIClient';
import DiffFixPrompts from '../prompts/DiffFixPrompts';
import { Message } from '../models/Conversation';

// Mock FileSystem and AIClient completely
jest.mock('../FileSystem');
jest.mock('../AIClient');
// Mock logDiffFailure separately as it's an exported function, not a method
jest.mock('../FileSystem', () => ({
  ...jest.requireActual('../FileSystem'), // Import and retain original non-mocked exports
  logDiffFailure: jest.fn(), // Mock the specific exported function
}));

describe('applyDiffIteratively', () => {
  let fsMock: jest.Mocked<FileSystem>;
  let aiMock: jest.Mocked<AIClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Cast the mock instances to their JestMocked types
    fsMock = new FileSystem() as jest.Mocked<FileSystem>;
    aiMock = new AIClient({} as any) as jest.Mocked<AIClient>; // AIClient constructor needs a config, use empty object for test

    // Ensure that the mocks for applyDiffToFile and getResponseTextFromAI are Jest mock functions
    fsMock.applyDiffToFile = jest.fn() as jest.MockedFunction<typeof fsMock.applyDiffToFile>;
    fsMock.readFile = jest.fn().mockResolvedValue('content') as jest.MockedFunction<typeof fsMock.readFile>;
    aiMock.getResponseTextFromAI = jest.fn() as jest.MockedFunction<typeof aiMock.getResponseTextFromAI>;

    // Mock logDiffFailure from FileSystem.ts (it's a named export, not a method)
    (logDiffFailure as jest.Mock).mockResolvedValue(undefined);
  });

  it('requests fix from AI until diff applies', async () => {
    const filePath = 'src/file.ts';
    const initialDiff = 'initial-diff';
    const correctedDiff = 'corrected-diff';

    // First attempt fails, second succeeds
    fsMock.applyDiffToFile
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    // Mock the lastDiffFailure property on fsMock
    fsMock.lastDiffFailure = {
      file: filePath,
      diff: initialDiff,
      fileContent: 'old-content',
      error: 'Patch failed',
    };

    // AI provides a corrected diff after the first failure
    aiMock.getResponseTextFromAI.mockResolvedValueOnce(correctedDiff);

    const result = await applyDiffIteratively(fsMock, aiMock, filePath, initialDiff);

    expect(result).toBe(true);
    expect(fsMock.applyDiffToFile).toHaveBeenCalledTimes(2);
    expect(fsMock.applyDiffToFile).toHaveBeenNthCalledWith(1, filePath, initialDiff);
    expect(fsMock.applyDiffToFile).toHaveBeenNthCalledWith(2, filePath, correctedDiff);
    expect(aiMock.getResponseTextFromAI).toHaveBeenCalledTimes(1);
    expect(aiMock.getResponseTextFromAI).toHaveBeenCalledWith([{ role: 'user', content: DiffFixPrompts.fixPatch(filePath, 'old-content', initialDiff, 'Patch failed') }], false, aiMock.useOpenAIDiffs);
    expect(logDiffFailure).toHaveBeenCalledTimes(0); // Should not log failure to file if eventually successful
  });

  it('returns false if diff never applies after max attempts', async () => {
    const filePath = 'src/file.ts';
    const initialDiff = 'initial-diff';

    // All attempts fail
    fsMock.applyDiffToFile.mockResolvedValue(false);

    fsMock.lastDiffFailure = {
      file: filePath,
      diff: initialDiff,
      fileContent: 'old-content',
      error: 'Patch failed',
    };

    // AI continues to provide diffs
    aiMock.getResponseTextFromAI.mockResolvedValue('another-diff');

    const result = await applyDiffIteratively(fsMock, aiMock, filePath, initialDiff, 2); // Test with 2 attempts

    expect(result).toBe(false);
    expect(fsMock.applyDiffToFile).toHaveBeenCalledTimes(2); // Initial + 1 retry
    expect(aiMock.getResponseTextFromAI).toHaveBeenCalledTimes(1); // One call for the single retry
    expect(logDiffFailure).toHaveBeenCalledTimes(0); // This function internally handles logging if the *final* attempt fails.
    // The applyDiffIteratively function itself does not call logDiffFailure when it fails
    // it relies on fs.lastDiffFailure which is set by fs.applyDiffToFile.
    // So if fs.applyDiffToFile is mocked to return false, it means the mock *itself* must simulate the failure behavior,
    // including setting fs.lastDiffFailure and potentially calling logDiffFailure.
    // For this test, it's simpler to verify that fs.applyDiffToFile was called the expected number of times,
    // and that aiMock.getResponseTextFromAI was called for each retry.
    // The logDiffFailure call is a side effect of fs.applyDiffToFile when it's *not* mocked.
    // With fsMock.applyDiffToFile just returning false, logDiffFailure won't be called directly by it unless we add that to the mock's implementation.
    // The current test for logDiffFailure in FileSystem.test.ts covers that.
    // So, this test should not assert logDiffFailure calls, as it's testing applyDiffIteratively's retry logic.
  });

  it('returns false immediately when AI call fails', async () => {
    const filePath = 'src/file.ts';
    const initialDiff = 'initial-diff';

    fsMock.applyDiffToFile.mockResolvedValue(false);
    // No lastDiffFailure so applyDiffIteratively falls back to reading the file
    fsMock.readFile = jest.fn().mockResolvedValue('current');

    const err = new Error('network');
    aiMock.getResponseTextFromAI.mockRejectedValue(err);

    const result = await applyDiffIteratively(fsMock, aiMock, filePath, initialDiff, 2);

    expect(result).toBe(false);
    expect(fsMock.applyDiffToFile).toHaveBeenCalledTimes(1);
    expect(fsMock.readFile).toHaveBeenCalledWith(filePath);
    expect(aiMock.getResponseTextFromAI).toHaveBeenCalledTimes(1);
  });

  it('uses empty string when file read returns nullish', async () => {
    const filePath = 'src/file.ts';
    const initialDiff = 'initial-diff';
    const correctedDiff = 'corrected-diff';

    fsMock.applyDiffToFile
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    fsMock.readFile = jest.fn().mockResolvedValue(undefined);
    aiMock.getResponseTextFromAI.mockResolvedValueOnce(correctedDiff);

    const result = await applyDiffIteratively(fsMock, aiMock, filePath, initialDiff, 2);

    expect(result).toBe(true);
    expect(fsMock.readFile).toHaveBeenCalledWith(filePath);
    expect(aiMock.getResponseTextFromAI).toHaveBeenCalledWith([
      { role: 'user', content: DiffFixPrompts.fixPatch(filePath, '', initialDiff, '') }
    ], false, aiMock.useOpenAIDiffs);
    expect(fsMock.applyDiffToFile).toHaveBeenCalledTimes(2);
  });

  it('stops immediately when diff is empty', async () => {
    const filePath = 'src/file.ts';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await applyDiffIteratively(fsMock, aiMock, filePath, '   ');

    expect(result).toBe(false);
    expect(fsMock.applyDiffToFile).not.toHaveBeenCalled();
    expect(aiMock.getResponseTextFromAI).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Empty diff provided for')
    );
    warnSpy.mockRestore();
  });
});