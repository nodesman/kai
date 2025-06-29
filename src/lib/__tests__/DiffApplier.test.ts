import { applyDiffIteratively } from '../DiffApplier';
import { FileSystem, DiffFailureInfo } from '../FileSystem';
import { AIClient } from '../AIClient';

describe('applyDiffIteratively', () => {
  it('requests fix from AI until diff applies', async () => {
    const fsMock = {
      applyDiffToFile: jest.fn(),
      readFile: jest.fn().mockResolvedValue('content'),
      lastDiffFailure: null as DiffFailureInfo | null,
    } as unknown as FileSystem;

    const aiMock = { getResponseTextFromAI: jest.fn() } as any as AIClient;

    fsMock.applyDiffToFile
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    fsMock.lastDiffFailure = { file: 'a.txt', diff: 'bad', fileContent: 'content', error: 'err' };
    aiMock.getResponseTextFromAI.mockResolvedValue('fixed');

    const result = await applyDiffIteratively(fsMock, aiMock, 'a.txt', 'bad', 2);

    expect(result).toBe(true);
    expect(fsMock.applyDiffToFile).toHaveBeenNthCalledWith(1, 'a.txt', 'bad');
    expect(aiMock.getResponseTextFromAI).toHaveBeenCalled();
    expect(fsMock.applyDiffToFile).toHaveBeenNthCalledWith(2, 'a.txt', 'fixed');
  });
});
