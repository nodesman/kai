import Gemini2FlashModel from '../Gemini2FlashModel';

describe('Gemini2FlashModel', () => {
    it('should be created', () => {
        const config: any = { gemini: { api_key: 'k', model_name: 'm1', subsequent_chat_model_name: 'm2', generation_max_retries: 1, generation_retry_base_delay_ms: 1 } };
        const model = new Gemini2FlashModel(config);
        expect(model).toBeDefined();
    });
});