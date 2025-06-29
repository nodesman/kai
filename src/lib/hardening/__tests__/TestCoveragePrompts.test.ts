import { TestCoveragePrompts } from '../TestCoveragePrompts';

describe('TestCoveragePrompts', () => {
    it('generates prompt', () => {
        const result = TestCoveragePrompts.generateTests('file.ts', 'code', 'info');
        expect(result).toContain('file.ts');
    });

    it('generates diff prompt', () => {
        const diffPrompt = TestCoveragePrompts.generateTestDiff('file.test.ts', 'tests', 'cov');
        expect(diffPrompt).toContain('file.test.ts');
        expect(diffPrompt).toContain('cov');
    });
});
