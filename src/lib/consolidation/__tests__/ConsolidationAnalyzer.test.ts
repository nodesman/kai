import { ConsolidationAnalyzer } from '../ConsolidationAnalyzer';

describe('ConsolidationAnalyzer', () => {
    it('should be created', () => {
        const analyzer = new ConsolidationAnalyzer({} as any);
        expect(analyzer).toBeDefined();
    });
});