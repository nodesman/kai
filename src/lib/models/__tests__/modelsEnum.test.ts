import { SupportedModels } from '../modelsEnum';

describe('Models', () => {
    it('should be created', () => {
        expect(SupportedModels.GEMINI_PRO).toBeDefined();
        expect(SupportedModels.OPENAI_GPT4O).toBeDefined();
    });
});