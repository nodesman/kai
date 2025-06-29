import Gemini2FlashModel from './Gemini2FlashModel';
import { FinishReason } from '@google/generative-ai';

// Reusable mock functions so tests can control behavior
const mockGenerateContent = jest.fn();
const mockSendMessage = jest.fn();
const mockStartChat = jest.fn(() => ({ sendMessage: mockSendMessage }));
const mockGetGenerativeModel = jest.fn(() => ({
  startChat: mockStartChat,
  generateContent: mockGenerateContent,
}));
const mockGoogleGenerativeAIConstructor = jest.fn();

// Mock the generative AI library so no real network calls occur
jest.mock('@google/generative-ai', () => ({
  FinishReason: {
    STOP: 'STOP',
    SAFETY: 'SAFETY',
    MAX_TOKENS: 'MAX_TOKENS',
    RECITATION: 'RECITATION',
  },
  GoogleGenerativeAI: class {
    constructor(apiKey: string) {
      mockGoogleGenerativeAIConstructor(apiKey);
    }
    getGenerativeModel = mockGetGenerativeModel;
  },
}));

// Helper to create the minimal configuration object expected by the model
const createConfig = () => ({
  gemini: {
    api_key: 'k',
    subsequent_chat_model_name: 'flash',
    generation_max_retries: 0,
    generation_retry_base_delay_ms: 1,
    max_output_tokens: 5
  }
});

describe('Gemini2FlashModel', () => {
  let model: Gemini2FlashModel;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGenerativeModel.mockReturnValue({
      startChat: mockStartChat,
      generateContent: mockGenerateContent,
    });
    model = new Gemini2FlashModel(createConfig() as any);
  });

  describe('convertToGeminiConversation', () => {
    it('merges consecutive messages with the same role and strips system messages', () => {
      const messages = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'assistant', content: 'c' },
        { role: 'system', content: 'ignore' },
        { role: 'user', content: 'd' }
      ];

      const result = model.convertToGeminiConversation(messages as any);
      expect(result).toEqual([
        { role: 'user', parts: [{ text: 'a' }] },
        { role: 'model', parts: [{ text: 'b' }, { text: 'c' }] },
        { role: 'user', parts: [{ text: 'd' }] }
      ]);
    });
  });

  describe('handleError', () => {
    it('classifies network errors', () => {
      const err = new Error('FETCH_ERROR');
      (err as any).name = 'FetchError';
      expect(() => model.handleError(err, 'flash')).toThrow(
        /AI API Error \(NETWORK_ERROR\)/
      );
    });

    it('classifies API errors based on status', () => {
      const err = { status: 429, message: 'Too many' } as any;
      expect(() => model.handleError(err, 'flash')).toThrow(
        /AI API Error \(RATE_LIMIT\)/
      );
    });

    it('falls back to general error handling', () => {
      const err = new Error('boom');
      const thrown = (() => {
        try {
          model.handleError(err, 'flash');
        } catch (e) {
          return e as any;
        }
      })();
      expect(thrown.code).toBe('UNKNOWN');
      expect(thrown.message).toContain('boom');
    });

    it('classifies google AI errors', () => {
      const err = new Error('[GoogleGenerativeAI Error] SAFETY');
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('SAFETY_BLOCK');
    });

    it('uses code property when present', () => {
      const err: any = new Error('x');
      err.code = 'EACCES';
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('EACCES');
    });

    it('handles request object as no response', () => {
      const thrown = (() => { try { model.handleError({ request: {} } as any, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('NO_RESPONSE');
    });

    it('classifies server overload by status code', () => {
      const err = { status: 500, message: 'err' } as any;
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('SERVER_OVERLOADED');
    });

    it('classifies server overload from message', () => {
      const err = new Error('503 server error');
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('SERVER_OVERLOADED');
    });

    it('classifies invalid API key from message', () => {
      const err = new Error('API key not valid');
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('INVALID_API_KEY');
    });

    it('classifies invalid API key by status', () => {
      const err = { status: 400, message: 'API key not valid' } as any;
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('INVALID_API_KEY');
    });

    it('classifies recitation errors', () => {
      const err = new Error('[GoogleGenerativeAI Error] recitation');
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('RECITATION_BLOCK');
    });

    it('classifies rate limit from message', () => {
      const err = new Error('429 too many');
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('RATE_LIMIT');
    });

    it('classifies safety block from message', () => {
      const err = new Error('safety violation');
      const thrown = (() => { try { model.handleError(err, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('SAFETY_BLOCK');
    });

    it('handles unknown objects', () => {
      const thrown = (() => { try { model.handleError({} as any, 'flash'); } catch (e) { return e as any; } })();
      expect(thrown.code).toBe('UNKNOWN');
    });
  });

  describe('constructor error handling', () => {
    it('throws when API key missing', () => {
      const cfg = createConfig();
      cfg.gemini.api_key = '';
      expect(() => new Gemini2FlashModel(cfg as any)).toThrow('Gemini API key is missing');
    });

    it('throws when generative model fails', () => {
      mockGetGenerativeModel.mockImplementation(() => { throw new Error('bad'); });
      expect(() => new Gemini2FlashModel(createConfig() as any)).toThrow('Failed to get generative model');
    });

    it('uses default retry settings when not provided', () => {
      const cfg = createConfig();
      delete (cfg.gemini as any).generation_max_retries;
      delete (cfg.gemini as any).generation_retry_base_delay_ms;
      const m = new Gemini2FlashModel(cfg as any);
      expect((m as any).maxRetries).toBe(3);
      expect((m as any).retryBaseDelay).toBe(2000);
    });
  });

  describe('getResponseFromAI', () => {
    it('rejects empty history', async () => {
      await expect(model.getResponseFromAI([] as any)).rejects.toThrow('Cannot get AI response');
    });

    it('converts messages then queries chat', async () => {
      const convertSpy = jest.spyOn(model, 'convertToGeminiConversation').mockReturnValue([{ role: 'user', parts: [{ text: 'q' }] }]);
      const querySpy = jest.spyOn(model, 'queryGeminiChat').mockResolvedValue('r');
      const messages = [{ role: 'user', content: 'hi' }];
      const res = await model.getResponseFromAI(messages as any);
      expect(convertSpy).toHaveBeenCalledWith(messages as any);
      expect(querySpy).toHaveBeenCalledWith([{ role: 'user', parts: [{ text: 'q' }] }]);
      expect(res).toBe('r');
    });
  });

  describe('queryGeminiChat', () => {
    beforeEach(() => {
      mockSendMessage.mockResolvedValue({ response: { text: () => 'ok' } });
    });

    it('uses default maxOutputTokens when not set', async () => {
      const cfg = createConfig();
      delete (cfg.gemini as any).max_output_tokens;
      model = new Gemini2FlashModel(cfg as any);
      await model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any);
      expect(mockStartChat).toHaveBeenCalledWith({ history: [], generationConfig: { maxOutputTokens: 8192 } });
    });

    it('returns text when successful', async () => {
      const history = [{ role: 'user', parts: [{ text: 'a' }] }];
      const res = await model.queryGeminiChat(history as any);
      expect(mockStartChat).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('a');
      expect(res).toBe('ok');
    });

    it('throws when last message not user', async () => {
      const history = [{ role: 'model', parts: [{ text: 'a' }] }];
      await expect(model.queryGeminiChat(history as any)).rejects.toThrow('Internal Error');
    });

    it('delegates errors to handleError', async () => {
      const err = new Error('boom');
      mockSendMessage.mockRejectedValue(err);
      const spy = jest.spyOn(model, 'handleError').mockImplementation(() => { throw err; });
      await expect(model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any)).rejects.toThrow('boom');
      spy.mockRestore();
    });

    it('returns empty string if handleError does not throw', async () => {
      const err = new Error('x');
      mockSendMessage.mockRejectedValue(err);
      const spy = jest.spyOn(model, 'handleError').mockImplementation(() => {});
      const res = await model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any);
      expect(res).toBe('');
      spy.mockRestore();
    });

    it('handles missing content with safety reason', async () => {
      mockSendMessage.mockResolvedValue({ response: { candidates: [{ finishReason: FinishReason.SAFETY, safetyRatings: { flag: true } }] } });
      await expect(model.queryGeminiChat([{ role: 'user', parts: [{ text: 'x' }] }] as any)).rejects.toThrow(/SAFETY/);
    });
  });

  describe('generateContent edge cases', () => {
    const REQUEST = { contents: [{ role: 'user', parts: [{ text: 'p' }] }] } as any;

    it('retries on retryable error then succeeds', async () => {
      jest.useFakeTimers();
      const cfg = createConfig();
      cfg.gemini.generation_max_retries = 1;
      cfg.gemini.generation_retry_base_delay_ms = 0;
      model = new Gemini2FlashModel(cfg as any);
      mockGenerateContent.mockRejectedValueOnce(Object.assign(new Error('fail'), { code: 'NETWORK_ERROR' }))
        .mockResolvedValueOnce({ response: { text: () => 'done' } });
      const promise = model.generateContent(REQUEST);
      await jest.runOnlyPendingTimersAsync();
      const res = await promise;
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(res.response.text()).toBe('done');
      jest.useRealTimers();
    });

    it('throws block errors via handleError', async () => {
      mockGenerateContent.mockResolvedValue({ response: { candidates: [{ finishReason: FinishReason.SAFETY, safetyRatings: [1] }] } });
      const spy = jest.spyOn(model, 'handleError').mockImplementation(() => { throw new Error('block'); });
      await expect(model.generateContent(REQUEST)).rejects.toThrow('block');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('warns on stop without text', async () => {
      mockGenerateContent.mockResolvedValue({ response: { candidates: [{ finishReason: FinishReason.STOP, content: { parts: [] } }] } });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      await model.generateContent(REQUEST);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('handles empty response object', async () => {
      mockGenerateContent.mockResolvedValue({});
      const spy = jest.spyOn(model, 'handleError').mockImplementation(() => { throw new Error('empty'); });
      await expect(model.generateContent(REQUEST)).rejects.toThrow('empty');
      spy.mockRestore();
    });

    it('throws original error when handleError does not', async () => {
      const err = new Error('orig');
      mockGenerateContent.mockRejectedValue(err);
      const spy = jest.spyOn(model, 'handleError').mockImplementation(() => {});
      await expect(model.generateContent(REQUEST)).rejects.toThrow('orig');
      spy.mockRestore();
    });
  });
});
