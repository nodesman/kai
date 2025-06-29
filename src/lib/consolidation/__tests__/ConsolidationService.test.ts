import { ConsolidationService } from '../ConsolidationService';
import { FileSystem } from '../../FileSystem';

describe('ConsolidationService', () => {
    it('should be created', () => {
        const service = new ConsolidationService(
            {} as any,
            new FileSystem(),
            {} as any,
            '/project',
            {} as any,
            {} as any,
            {} as any,
            []
        );
        expect(service).toBeDefined();
    });
});