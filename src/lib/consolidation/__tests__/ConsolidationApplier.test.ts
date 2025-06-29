import { ConsolidationApplier } from '../ConsolidationApplier';
import { FileSystem } from '../../FileSystem';

describe('ConsolidationApplier', () => {
    it('should be created', () => {
        const applier = new ConsolidationApplier(new FileSystem());
        expect(applier).toBeDefined();
    });
});