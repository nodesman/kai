import { TestCoverageRaiser } from '../TestCoverageRaiser';
import { FileSystem } from '../../FileSystem';
import { CommandService } from '../../CommandService';

describe('TestCoverageRaiser', () => {
    it('creates instance', () => {
        const raiser = new TestCoverageRaiser({} as any, new FileSystem(), new CommandService(), {} as any, '/project');
        expect(raiser).toBeDefined();
    });
});
