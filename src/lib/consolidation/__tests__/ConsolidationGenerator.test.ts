import { ConsolidationGenerator } from '../ConsolidationGenerator';
import { FileSystem } from '../../FileSystem';

describe('ConsolidationGenerator', () => {
    it('should be created', () => {
        const generator = new ConsolidationGenerator({} as any, new FileSystem(), {} as any, '/project');
        expect(generator).toBeDefined();
    });
});