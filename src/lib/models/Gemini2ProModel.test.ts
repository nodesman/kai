import { GoogleGenerativeAI, GenerateContentRequest, Content, FinishReason } from '@google/generative-ai';
import { Config } from '../Config'; // Import Config for type reference
import Gemini2ProModel from './Gemini2ProModel';
import { InteractivePromptReviewer } from '../UserInteraction/InteractivePromptReviewer';

// --- Mocks for @google/generative-ai ---
var mockResponseText = jest.fn();
var mockResponse = { text: mockResponseText };

var mockGenerateContent = jest.fn();
var mockSendMessage = jest.fn();
var mockStartChat = jest.fn(() => ({ sendMessage: mockSendMessage }));
var mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
  startChat: mockStartChat,
}));

var mockGoogleGenerativeAIConstructor = jest.fn();

jest.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    getGenerativeModel: typeof mockGetGenerativeModel;

    constructor(apiKey: string) {
      mockGoogleGenerativeAIConstructor(apiKey);
      this.getGenerativeModel = mockGetGenerativeModel;
    }
  }

  return {
    FinishReason: {
      STOP: 'STOP',
      SAFETY: 'SAFETY',
      MAX_TOKENS: 'MAX_TOKENS',
    },
    GoogleGenerativeAI: MockGoogleGenerativeAI,
  };
});
// --- End Mocks ---

// --- Mock Config ---
const createMockConfig = (modelName = 'gemini-1.5-pro-latest'): Partial<Config> => ({
    gemini: {
        api_key: 'test-api-key',
        model_name: modelName,
        subsequent_chat_model_name: 'gemini-1.5-flash-latest',
        max_output_tokens: 8192,
        max_prompt_tokens: 32000,
        generation_max_retries: 3,
        generation_retry_base_delay_ms: 2000,
        interactive_prompt_review: false,
        rate_limit: { requests_per_minute: 60 },
        max_retries: 3,
        retry_delay: 1000,
    },
});
// --- End Mock Config ---


// Mock InteractivePromptReviewer
var mockReviewPrompt = jest.fn();
jest.mock('../UserInteraction/InteractivePromptReviewer', () => ({
  InteractivePromptReviewer: jest.fn().mockImplementation(() => ({
    reviewPrompt: mockReviewPrompt,
  })),
}));

describe('Gemini2ProModel', () => {
  const MOCK_API_KEY = 'test-api-key';
  const MOCK_PROMPT = 'Hello, Gemini!';
  const MOCK_GENERATED_TEXT = 'Hello from Gemini!';

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent, startChat: mockStartChat });
  });

  // --- Constructor Tests ---
  it('should throw an error if API key is not provided', () => {
    const configWithoutApiKey = createMockConfig();
    configWithoutApiKey.gemini!.api_key = '';
    expect(() => new Gemini2ProModel(configWithoutApiKey as Config)).toThrow('Gemini API key is missing in the configuration.');
    expect(mockGoogleGenerativeAIConstructor).not.toHaveBeenCalled();
  });

  it('should initialize with provided API key and a valid gemini model name', () => {
    const mockConfigInstance = createMockConfig('gemini-pro-valid');
    const model = new Gemini2ProModel(mockConfigInstance as Config);
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAIConstructor).toHaveBeenCalledWith(MOCK_API_KEY);
    expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-pro-valid' });
  });

  it('should NOT initialize google client for a non-gemini model name', () => {
    const customConfigInstance = createMockConfig('claude-opus-123');
    const model = new Gemini2ProModel(customConfigInstance as Config);
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAIConstructor).toHaveBeenCalledWith(MOCK_API_KEY); // The client is still created
    expect(mockGetGenerativeModel).not.toHaveBeenCalled(); // But the model is not fetched
    expect((model as any).model).toEqual({}); // The internal model is a dummy object
  });

  it('throws if generative model cannot be created', () => {
    const cfg = createMockConfig();
    mockGetGenerativeModel.mockImplementation(() => { throw new Error('fail'); });
    expect(() => new Gemini2ProModel(cfg as Config)).toThrow(/Failed to get generative model/);
  });

  it('getResponseFromAI rejects empty messages', async () => {
    const cfg = createMockConfig();
    const model = new Gemini2ProModel(cfg as Config);
    await expect(model.getResponseFromAI([] as any)).rejects.toThrow('Cannot get AI response');
  });

  const MOCK_GENERATE_CONTENT_REQUEST: GenerateContentRequest = {
    contents: [{ role: 'user', parts: [{ text: MOCK_PROMPT }] }]
  };

  // --- generateContent Method Tests ---
  describe('generateContent', () => {
    let model: Gemini2ProModel;
    let defaultConfig: Partial<Config>;

    beforeEach(() => {
      defaultConfig = createMockConfig();
      model = new Gemini2ProModel(defaultConfig as Config);
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: mockResponse });
    });

    it('should call the Gemini API and return the generated text', async () => {
      const result = await model.generateContent(MOCK_GENERATE_CONTENT_REQUEST);
      expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
        contents: MOCK_GENERATE_CONTENT_REQUEST.contents,
      }));
      const text = result.response?.text();
      expect(text).toBe(MOCK_GENERATED_TEXT);
    });

    it('should handle errors from the Gemini API during content generation', async () => {
      const errorMessage = 'API error occurred during generation';
      mockGenerateContent.mockRejectedValue(new Error(errorMessage));
      await expect(model.generateContent(MOCK_GENERATE_CONTENT_REQUEST)).rejects.toThrow(`AI API Error (UNKNOWN) using ${defaultConfig.gemini!.model_name}: ${errorMessage}`);
    });
  });

  describe('queryGeminiChat', () => {
    let model: Gemini2ProModel;
    beforeEach(() => {
      jest.clearAllMocks();
      mockSendMessage.mockResolvedValue({ response: { text: () => 'ok' } });
      model = new Gemini2ProModel(createMockConfig() as Config);
    });

    it('sends prompt directly when interactive review disabled', async () => {
      const convo = [{ role: 'user', parts: [{ text: 'a' }] }];
      const res = await model.queryGeminiChat(convo as any);
      expect(mockStartChat).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('a');
      expect(res).toBe('ok');
    });

    it('handles interactive review', async () => {
      const config = createMockConfig();
      config.gemini!.interactive_prompt_review = true;
      mockReviewPrompt.mockResolvedValue('edited');
      model = new Gemini2ProModel(config as Config);
      await model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any);
      expect(mockReviewPrompt).toHaveBeenCalledWith('a');
      expect(mockSendMessage).toHaveBeenCalledWith('edited');
    });

    it('returns empty string when user cancels', async () => {
      const config = createMockConfig();
      config.gemini!.interactive_prompt_review = true;
      mockReviewPrompt.mockResolvedValue(null);
      model = new Gemini2ProModel(config as Config);
      const res = await model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any);
      expect(res).toBe('');
    });
  });

  describe('handleError', () => {
    let model: Gemini2ProModel;
    beforeEach(() => {
      model = new Gemini2ProModel(createMockConfig() as Config);
    });

    const cases: [any, string][] = [
      [Object.assign(new Error('FETCH_ERROR'), { name: 'FetchError' }), 'NETWORK_ERROR'],
      [new Error('[GoogleGenerativeAI Error] 429'), 'RATE_LIMIT'],
      [new Error('[GoogleGenerativeAI Error] 400 Bad Request: model not found'), 'INVALID_MODEL'],
      [{ status: 400, message: 'model not found' }, 'INVALID_MODEL'],
      [{ status: 503, message: 'backend error' }, 'SERVER_OVERLOADED'],
      [{ code: 'EACCES', message: 'denied' }, 'EACCES'],
      [new Error('[GoogleGenerativeAI Error] recitation'), 'RECITATION_BLOCK'],
      [new Error('oops'), 'UNKNOWN'],
    ];

    for (const [err, code] of cases) {
      it(`classifies error code ${code}`, () => {
        try {
          model.handleError(err, 'gemini-pro');
        } catch (e: any) {
          expect(e.code).toBe(code);
        }
      });
    }
  });
});