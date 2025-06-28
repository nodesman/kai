import { TestRunnerService } from '../TestRunnerService';

describe('TestRunnerService', () => {
  it('runs jest and parses summary', async () => {
    const cmd = { run: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }) } as any;
    const fs = { readFile: jest.fn().mockResolvedValue('{"total":{"lines":{"pct":80}}}') } as any;
    const svc = new TestRunnerService(cmd, fs);
    const summary = await svc.runCoverage('/p');
    expect(cmd.run).toHaveBeenCalledWith('npx jest --coverage --coverageReporters=json-summary', { cwd: '/p' });
    expect(summary.total.lines.pct).toBe(80);
  });
});
