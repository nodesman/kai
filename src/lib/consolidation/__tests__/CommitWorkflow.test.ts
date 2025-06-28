import { ConsolidationService } from '../ConsolidationService';

describe('commit workflow', () => {
  const baseConfig:any = { gemini:{}, project:{} };
  const fs:any = {};
  const ai:any = { logConversation: jest.fn() };

  test('commits when user approves', async () => {
    const git = {
      checkCleanStatus: jest.fn().mockRejectedValue(new Error('Git working directory not clean. Please commit or stash changes before proceeding.')),
      listModifiedFiles: jest.fn().mockResolvedValue(['a.ts']),
      getDiff: jest.fn().mockResolvedValue('diff'),
      stageAllChanges: jest.fn().mockResolvedValue(undefined),
      commitAll: jest.fn().mockResolvedValue(undefined),
    } as any;
    const ui = {
      displayChangedFiles: jest.fn(),
      promptGenerateCommit: jest.fn().mockResolvedValue(true),
      confirmCommitMessage: jest.fn().mockResolvedValue(true)
    } as any;
    const commitSvc = { generateCommitMessage: jest.fn().mockResolvedValue('msg') } as any;
    const service = new ConsolidationService(baseConfig, fs, ai, '/p', git, ui, commitSvc, []);
    await (service as any)._performGitCheck('file');
    expect(git.stageAllChanges).toHaveBeenCalled();
    expect(git.commitAll).toHaveBeenCalledWith('/p','msg');
  });

  test('throws when user aborts commit', async () => {
    const git = {
      checkCleanStatus: jest.fn().mockRejectedValue(new Error('Git working directory not clean. Please commit or stash changes before proceeding.')),
      listModifiedFiles: jest.fn().mockResolvedValue(['a.ts'])
    } as any;
    const ui = {
      displayChangedFiles: jest.fn(),
      promptGenerateCommit: jest.fn().mockResolvedValue(false),
      confirmCommitMessage: jest.fn()
    } as any;
    const commitSvc = { generateCommitMessage: jest.fn() } as any;
    const service = new ConsolidationService(baseConfig, fs, ai, '/p', git, ui, commitSvc, []);
    await expect((service as any)._performGitCheck('file')).rejects.toThrow('Uncommitted changes');
  });
});
