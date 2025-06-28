import { ConsolidationService } from '../ConsolidationService';
import { FeedbackLoop } from '../feedback/FeedbackLoop';

jest.mock('chalk', () => ({ __esModule: true, default: new Proxy({}, { get: () => (s: string)=>s }) }));

const dummyMessage = { role: 'user', content: 'hi' } as any;

class DummyGenerator {
    calls:number = 0;
    async generate(){ this.calls++; return {}; }
    setAIClient(){ }
}

class DummyAnalyzer {
    async analyze(){ return { operations: [{ action: 'CREATE', filePath: 'file.ts' }] }; }
    setAIClient(){ }
}

class DummyApplier {
    async apply(){ return { success:1, failed:0, skipped:0, summary:[] }; }
}

describe('ConsolidationService feedback loops', () => {
    it('retries generation when loop fails', async () => {
        const loop: FeedbackLoop = {
            run: jest.fn()
                .mockResolvedValueOnce({ success:false, log:'err' })
                .mockResolvedValueOnce({ success:true, log:'' })
        };
        const config:any = { project:{ autofix_iterations:2 } };
        const fs:any = {};
        const ai:any = { logConversation: jest.fn() };
        const git:any = { checkCleanStatus: jest.fn() };
        const ui:any = { displayChangedFiles: jest.fn(), promptGenerateCommit: jest.fn(), confirmCommitMessage: jest.fn() };
        const commitSvc:any = { generateCommitMessage: jest.fn() };
        const service = new ConsolidationService(config, fs, ai, '/p', git, ui, commitSvc, [loop]);
        (service as any).consolidationAnalyzer = new DummyAnalyzer();
        const gen = new DummyGenerator();
        (service as any).consolidationGenerator = gen;
        (service as any).consolidationApplier = new DummyApplier();
        (service as any)._findRelevantHistorySlice = () => [dummyMessage];
        (service as any)._determineModels = () => ({useFlashForAnalysis:false,useFlashForGeneration:false,analysisModelName:'a',generationModelName:'b'});
        await service.process('conv',{ getMessages:()=>[dummyMessage], addMessage:()=>{} } as any,'ctx','file');
        expect(gen.calls).toBe(2);
        expect((loop.run as jest.Mock).mock.calls.length).toBe(2);
    });
});
