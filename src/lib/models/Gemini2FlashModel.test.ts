import Gemini2FlashModel from './Gemini2FlashModel';
import { FinishReason } from '@google/generative-ai';

// Mock the generative AI library so no real network calls occur
jest.mock('@google/generative-ai', () => {
  return {
    FinishReason: {
      STOP: 'STOP',
      SAFETY: 'SAFETY',
      MAX_TOKENS: 'MAX_TOKENS',
      RECITATION: 'RECITATION'
    },
    GoogleGenerativeAI: class {
      // minimal mock that returns a dummy model with the methods used by the class
      getGenerativeModel() {
        return {
          startChat: jest.fn(() => ({ sendMessage: jest.fn() })),
          generateContent: jest.fn()
        };
      }
    }
  };
});

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
  });
});
