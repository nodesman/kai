import { SupportedModels } from '../modelsEnum';

describe('SupportedModels', () => {
    it('should have GEMINI_PRO and GEMINI_FLASH models defined', () => {
        expect(SupportedModels.GEMINI_PRO).toBe('gemini-1.5-pro');
        expect(SupportedModels.GEMINI_FLASH).toBe('gemini-1.5-flash');
    });
});