import { ConsolidationAnalyzer } from './ConsolidationAnalyzer';

describe('ConsolidationAnalyzer', () => {
  let analyzer: ConsolidationAnalyzer;

  beforeEach(() => {
    analyzer = new ConsolidationAnalyzer();
  });

  it('should be defined', () => {
    expect(analyzer).toBeDefined();
  });

  it('should return an empty result for an empty array of items', () => {
    const result = analyzer.analyze([]);
    expect(result).toEqual({ summary: 'No items to analyze', consolidatedItems: [] });
  });

  it('should analyze a small array of items and mark them as processed', () => {
    const items = [{ id: 1, name: 'Item A' }, { id: 2, name: 'Item B' }];
    const result = analyzer.analyze(items);
    expect(result.summary).toContain('Analyzed 2 items');
    expect(result.consolidatedItems.length).toBe(2);
    expect(result.consolidatedItems[0]).toEqual(expect.objectContaining({ id: 1, name: 'Item A', processed: true }));
    expect(result.consolidatedItems[1]).toEqual(expect.objectContaining({ id: 2, name: 'Item B', processed: true }));
  });
});
