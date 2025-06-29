import { GoogleGenerativeAI, GenerateContentRequest, Content, FinishReason } from '@google/generative-ai';
import { Config } from '../Config'; // Import Config for type reference
import Gemini2ProModel from './Gemini2ProModel';

// --- Mocks for @google/generative-ai ---
// Using 'var' for top-level mocks referenced in jest.mock to avoid ReferenceError
// due to hoisting behavior differences between 'const'/'let' and 'var'.
var mockResponseText = jest.fn();
var mockResponse = { text: mockResponseText };

var mockGenerateContent = jest.fn();
var mockSendMessage = jest.fn();
var mockStartChat = jest.fn(() => ({ sendMessage: mockSendMessage }));
var mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
  startChat: mockStartChat,
}));

// Renamed for clarity: this is the spy that tracks the *constructor calls* for GoogleGenerativeAI.
var mockGoogleGenerativeAIConstructor = jest.fn();

// Apply the mock to the @google/generative-ai module
// This ensures that any instantiation of GoogleGenerativeAI within Gemini2ProModel
// uses our mock instead of the actual library.
jest.mock('@google/generative-ai', () => {
  // Define a mock class that matches the constructor signature and has the expected method
  class MockGoogleGenerativeAI {
    getGenerativeModel: typeof mockGetGenerativeModel; // Type declaration for the method

    constructor(apiKey: string) {
      mockGoogleGenerativeAIConstructor(apiKey); // Track constructor call
      this.getGenerativeModel = mockGetGenerativeModel; // Assign the mocked method
    }
  }

  return {
    // Crucially, export FinishReason here so the model can access it
    // Mock only the values actually used in the model's logic
    FinishReason: {
      STOP: 'STOP',
      SAFETY: 'SAFETY',
      MAX_TOKENS: 'MAX_TOKENS',
    },
    GoogleGenerativeAI: MockGoogleGenerativeAI,
  };
});
// --- End Mocks ---

// Mock the Config module
jest.mock('../Config', () => {
  // This mock simulates the Config class (which is actually ConfigLoader).
  // It has a parameterless constructor and public properties that can be modified by tests.
  class MockConfig {
    // --- Declare properties to match ConfigLoader instance ---
    public gemini: any; // Using 'any' for simplicity in mock
    public project: any;
    public analysis: any;
    public context: any;
    public chatsDir: string;
    public saveConfig: jest.Mock;
    public getConfigFilePath: jest.Mock;

    constructor() {
      // --- Initialize with default mock data ---
      this.gemini = { api_key: '', model_name: 'gemini-pro', subsequent_chat_model_name: 'gemini-flash', max_output_tokens: 8192, max_prompt_tokens: 32000, generation_max_retries: 3, generation_retry_base_delay_ms: 2000, interactive_prompt_review: false, rate_limit: { requests_per_minute: 60 } };
      this.project = { root_dir: '.', prompts_dir: 'prompts', prompt_template: 'prompt.yaml', chats_dir: '.kai/logs', typescript_autofix: false, autofix_iterations: 3, coverage_iterations: 3 };
      this.analysis = { cache_file_path: '.kai/project_analysis.json' };
      this.context = { mode: 'full' };
      this.chatsDir = '/mock/kai/logs'; // Dummy value
      this.saveConfig = jest.fn(); // Mock the method
      this.getConfigFilePath = jest.fn(() => '/mock/kai/config.yaml'); // Mock the method
    }
  }
  return { Config: MockConfig }; // Export the mock class as 'Config'
});

// Mock InteractivePromptReviewer with a simple class exposing reviewPrompt
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
    jest.clearAllMocks(); // Clears all call histories and mock return values
    // Re-set the return value for mockGetGenerativeModel because clearAllMocks would clear it
    mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent, startChat: mockStartChat });
    // No need to re-mock mockGoogleGenerativeAI.mockImplementation here, it's defined globally
  });

  // Helper to create and configure a mock Config instance
  const createMockConfig = (apiKey: string, modelName?: string): Config => {
    const config = new Config() as jest.Mocked<Config>; // Cast to Mocked<Config> to access mocked properties
    config.gemini.api_key = apiKey;
    if (modelName) {
      config.gemini.model_name = modelName;
    }
    return config;
  };

  // --- Constructor Tests ---
  it('should throw an error if API key is not provided', () => {
    // This test covers the validation branch inside the constructor
    const configWithoutApiKey = createMockConfig('');
    expect(() => new Gemini2ProModel(configWithoutApiKey)).toThrow('Gemini API key is missing in the configuration.');
    expect(mockGoogleGenerativeAIConstructor).not.toHaveBeenCalled(); // Ensure the client is not instantiated
  });

  it('should initialize with provided API key and default model name', () => {
    // This covers the default model name assignment branch
    const mockConfigInstance = createMockConfig(MOCK_API_KEY, 'gemini-pro'); // Default name
    const model = new Gemini2ProModel(mockConfigInstance);
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAIConstructor).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerativeAIConstructor).toHaveBeenCalledWith(MOCK_API_KEY);
  });

  it('should initialize with provided API key and a custom model name', () => {
    const customModelName = 'my-custom-gemini-model';
    // This covers the custom model name assignment branch
    const customConfigInstance = createMockConfig(MOCK_API_KEY, customModelName);
    const model = new Gemini2ProModel(customConfigInstance);
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAIConstructor).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerativeAIConstructor).toHaveBeenCalledWith(MOCK_API_KEY);
  });

  it('throws if generative model cannot be created', () => {
    const cfg = createMockConfig(MOCK_API_KEY);
    mockGetGenerativeModel.mockImplementation(() => { throw new Error('fail'); });
    expect(() => new Gemini2ProModel(cfg)).toThrow(/Failed to get generative model/);
  });

  it('getResponseFromAI rejects empty messages', async () => {
    const cfg = createMockConfig(MOCK_API_KEY);
    const model = new Gemini2ProModel(cfg);
    await expect(model.getResponseFromAI([] as any)).rejects.toThrow('Cannot get AI response');
  });

  // Define the GenerateContentRequest for the tests
  const MOCK_GENERATE_CONTENT_REQUEST: GenerateContentRequest = {
    contents: [{ role: 'user', parts: [{ text: MOCK_PROMPT }] }]
  };

  // --- generateContent Method Tests ---
  describe('generateContent', () => {
    let model: Gemini2ProModel;
    let defaultMockConfig: Config;

    beforeEach(() => {
      jest.clearAllMocks(); // <--- Moved clearAllMocks to before model instantiation
      // Re-initialize the model for each 'generateContent' test to ensure a clean state after clearing mocks
      defaultMockConfig = createMockConfig(MOCK_API_KEY, 'gemini-pro');
      model = new Gemini2ProModel(defaultMockConfig);

      // Reset mock implementations for the generation process
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: mockResponse });
      mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent, startChat: mockStartChat }); // Ensure it's set for this test
    });

    it('should call the Gemini API with the default model and return the generated text', async () => {
      const expectedModelName = defaultMockConfig.gemini.model_name;
      const result = await model.generateContent(MOCK_GENERATE_CONTENT_REQUEST);

      // Assert that the correct methods on the mock client were called
      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: expectedModelName });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith({
        contents: MOCK_GENERATE_CONTENT_REQUEST.contents,
        generationConfig: { maxOutputTokens: defaultMockConfig.gemini.max_output_tokens },
      });
      const text = result.response?.text();
      expect(mockResponseText).toHaveBeenCalledTimes(1);
      expect(text).toBe(MOCK_GENERATED_TEXT); // Check actual text content
    });

    it('should call the Gemini API with a custom model and return the generated text', async () => {
      const customModelName = 'my-custom-gemini-model';
      const customConfigInstance = createMockConfig(MOCK_API_KEY, customModelName);
      jest.clearAllMocks(); // Clear any calls from the default model setup
      model = new Gemini2ProModel(customConfigInstance);

      // Reset generateContent related mocks after clearing
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: mockResponse });
      mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent, startChat: mockStartChat }); // Ensure it's set for this test

      const result = await model.generateContent(MOCK_GENERATE_CONTENT_REQUEST);

      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: customModelName });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith({
        contents: MOCK_GENERATE_CONTENT_REQUEST.contents,
        generationConfig: { maxOutputTokens: customConfigInstance.gemini.max_output_tokens },
      });
      const text = result.response?.text();
      expect(mockResponseText).toHaveBeenCalledTimes(1);
      expect(text).toBe(MOCK_GENERATED_TEXT); // Check actual text content
    });

    it('should handle errors from the Gemini API during content generation', async () => {
      const errorMessage = 'API error occurred during generation';
      // Simulate a rejected promise from generateContent
      mockGenerateContent.mockRejectedValue(new Error(errorMessage));
      // Expect the method to rethrow a wrapped error
      await expect(model.generateContent(MOCK_GENERATE_CONTENT_REQUEST)).rejects.toThrow(`AI API Error (UNKNOWN) using ${defaultMockConfig.gemini.model_name}: ${errorMessage}`);
      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockResponseText).not.toHaveBeenCalled();
    });
  });
});

describe('Gemini2ProModel additional methods', () => {
  const config = new Config() as jest.Mocked<Config>;
  config.gemini.api_key = 'k';
  const EDGE_REQUEST: GenerateContentRequest = {
    contents: [{ role: 'user', parts: [{ text: 'x' }] }]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent, startChat: mockStartChat });
  });

  test('convertToGeminiConversation merges and warns when last message is model', () => {
    const model = new Gemini2ProModel(config);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const result = model.convertToGeminiConversation([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'system', content: 'ignore' },
      { role: 'assistant', content: 'd' },
    ] as any);
    expect(result).toEqual([
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ text: 'b' }, { text: 'c' }, { text: 'd' }] },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  describe('queryGeminiChat', () => {
    let model: Gemini2ProModel;

    beforeEach(() => {
      mockSendMessage.mockResolvedValue({ response: { text: () => 'ok' } });
      model = new Gemini2ProModel(config);
    });

    test('sends prompt directly when interactive review disabled', async () => {
      const history = model.convertToGeminiConversation([{ role: 'user', content: 'p' }] as any);
      const text = await model.queryGeminiChat(history);
      expect(mockReviewPrompt).not.toHaveBeenCalled();
      expect(mockStartChat).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('p');
      expect(text).toBe('ok');
    });

    test('uses reviewed prompt when interactive review enabled', async () => {
      config.gemini.interactive_prompt_review = true;
      mockReviewPrompt.mockResolvedValue('edited');
      model = new Gemini2ProModel(config);
      const history = model.convertToGeminiConversation([{ role: 'user', content: 'p' }] as any);
      const text = await model.queryGeminiChat(history);
      expect(mockReviewPrompt).toHaveBeenCalledWith('p');
      expect(mockSendMessage).toHaveBeenCalledWith('edited');
      expect(text).toBe('ok');
    });

    test('returns empty string when review cancelled', async () => {
      config.gemini.interactive_prompt_review = true;
      mockReviewPrompt.mockResolvedValue(null);
      model = new Gemini2ProModel(config);
      const history = model.convertToGeminiConversation([{ role: 'user', content: 'p' }] as any);
      const text = await model.queryGeminiChat(history);
      expect(text).toBe('');
    });

    test('delegates errors to handleError', async () => {
      const err = new Error('bad');
      mockSendMessage.mockResolvedValue({ response: {} });
      config.gemini.interactive_prompt_review = false;
      model = new Gemini2ProModel(config);
      const history = model.convertToGeminiConversation([{ role: 'user', content: 'p' }] as any);
      const spy = jest.spyOn(model, 'handleError').mockImplementation(() => { throw err; });
      await expect(model.queryGeminiChat(history)).rejects.toThrow('bad');
      spy.mockRestore();
    });

    test('throws when last message is not user', async () => {
      model = new Gemini2ProModel(config);
      const history = [{ role: 'model', parts: [{ text: 'a' }] }] as any;
      await expect(model.queryGeminiChat(history)).rejects.toThrow('Internal Error');
    });
  });

  describe('handleError', () => {
    let model: Gemini2ProModel;
    beforeEach(() => {
      model = new Gemini2ProModel(config);
    });

    test('classifies network errors', () => {
      const err = new Error('FETCH_ERROR');
      (err as any).name = 'FetchError';
      expect(() => model.handleError(err, 'pro')).toThrow(/NETWORK_ERROR/);
    });

    test('classifies API errors based on status', () => {
      const err = { status: 429, message: 'Too many' } as any;
      expect(() => model.handleError(err, 'pro')).toThrow(/RATE_LIMIT/);
    });

    test('falls back to general error handling', () => {
      const err = new Error('boom');
      const thrown = (() => { try { model.handleError(err, 'pro'); } catch (e) { return e as any; }})();
      expect(thrown.code).toBe('UNKNOWN');
      expect(thrown.message).toContain('boom');
    });

    test('classifies google AI errors', () => {
      const err = new Error('[GoogleGenerativeAI Error] backend error');
      const thrown = (() => { try { model.handleError(err, 'pro'); } catch (e) { return e as any; }})();
      expect(thrown.code).toBe('SERVER_OVERLOADED');
    });

    test('classifies safety errors', () => {
      const err = new Error('SAFETY violation');
      const thrown = (() => { try { model.handleError(err, 'pro'); } catch (e) { return e as any; }})();
      expect(thrown.code).toBe('SAFETY_BLOCK');
    });

    test('returns code from error.code field', () => {
      const err: any = new Error('x');
      err.code = 'CUSTOM';
      const thrown = (() => { try { model.handleError(err, 'pro'); } catch (e) { return e as any; }})();
      expect(thrown.code).toBe('CUSTOM');
    });

    test('handles unknown non-error objects', () => {
      const thrown = (() => { try { model.handleError({} as any, 'pro'); } catch (e) { return e as any; }})();
      expect(thrown.code).toBe('UNKNOWN');
    });
  });

  describe('generateContent edge cases', () => {
    let model: Gemini2ProModel;

    beforeEach(() => {
      config.gemini.generation_max_retries = 1;
      config.gemini.generation_retry_base_delay_ms = 0;
      model = new Gemini2ProModel(config);
      mockResponseText.mockReturnValue('out');
    });

    test('retries on retryable error then succeeds', async () => {
      jest.useFakeTimers();
      const err = new Error('timeout');
      (err as any).code = 'NETWORK_ERROR';
      mockGenerateContent.mockRejectedValueOnce(err).mockResolvedValueOnce({ response: mockResponse });
      const promise = model.generateContent(EDGE_REQUEST);
      await jest.runOnlyPendingTimersAsync();
      const result = await promise;
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(result.response).toBe(mockResponse);
      jest.useRealTimers();
    });

    test('throws block error and passes to handleError', async () => {
      mockGenerateContent.mockResolvedValue({ response: { candidates: [{ finishReason: FinishReason.SAFETY, safetyRatings: [1] }] } });
      const spy = jest.spyOn(model, 'handleError').mockImplementation(() => { throw new Error('block'); });
      await expect(model.generateContent(EDGE_REQUEST)).rejects.toThrow('block');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    test('warns when no text produced but finishReason STOP', async () => {
      mockGenerateContent.mockResolvedValue({ response: { candidates: [{ finishReason: FinishReason.STOP, content: { parts: [] } }] } });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      await model.generateContent(EDGE_REQUEST);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test('handles missing response object', async () => {
      mockGenerateContent.mockResolvedValue({});
      const spy = jest.spyOn(model, 'handleError').mockImplementation(() => { throw new Error('empty'); });
      await expect(model.generateContent(EDGE_REQUEST)).rejects.toThrow('empty');
      spy.mockRestore();
    });
  });
});
