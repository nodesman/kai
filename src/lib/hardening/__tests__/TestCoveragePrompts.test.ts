import { TestCoveragePrompts } from '../TestCoveragePrompts';

describe('TestCoveragePrompts', () => {
    it('generates prompt', () => {
        const result = TestCoveragePrompts.generateTests('file.ts', 'code', 'info');
        expect(result).toContain('file.ts');
    });
});
