import { CoverageService, TestGenerator } from '../CoverageService';

describe('CoverageService', () => {
  it('loops until coverage is 100%', async () => {
    const config: any = { project: { coverage_iterations: 2 } };
    const runner = { runCoverage: jest.fn()
      .mockResolvedValueOnce({ total: { lines: { pct: 80 } } })
      .mockResolvedValueOnce({ total: { lines: { pct: 90 } } })
      .mockResolvedValueOnce({ total: { lines: { pct: 100 } } })
    } as any;
    const generator: TestGenerator = { generateTests: jest.fn().mockResolvedValue(undefined) };
    const svc = new CoverageService(config, runner, generator);
    const summary = await svc.improveCoverage('/p');
    expect(runner.runCoverage).toHaveBeenCalledTimes(3);
    expect(generator.generateTests).toHaveBeenCalledTimes(2);
    expect(summary.total.lines.pct).toBe(100);
  });
});
