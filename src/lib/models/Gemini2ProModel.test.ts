import { GoogleGenerativeAI, GenerateContentRequest, Content, FinishReason } from '@google/generative-ai';
import { Config } from '../Config'; // Import Config for type reference
import Gemini2ProModel from './Gemini2ProModel';
import { InteractivePromptReviewer } from '../UserInteraction/InteractivePromptReviewer';

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

// Mock InteractivePromptReviewer so we can control reviewPrompt behavior
var mockReviewPrompt = jest.fn();
jest.mock('../UserInteraction/InteractivePromptReviewer', () => {
  return {
    InteractivePromptReviewer: jest.fn().mockImplementation(() => ({
      reviewPrompt: mockReviewPrompt,
    })),
  };
});

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

  // --- Additional method coverage ---
  describe('convertToGeminiConversation', () => {
    it('merges consecutive roles and warns when ending with model message', () => {
      const config = createMockConfig(MOCK_API_KEY);
      const model = new Gemini2ProModel(config);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const messages = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'assistant', content: 'c' }
      ];
      const conv = model.convertToGeminiConversation(messages as any);
      expect(conv).toEqual([
        { role: 'user', parts: [{ text: 'a' }] },
        { role: 'model', parts: [{ text: 'b' }, { text: 'c' }] }
      ]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('getResponseFromAI', () => {
    it('throws on empty history', async () => {
      const model = new Gemini2ProModel(createMockConfig(MOCK_API_KEY));
      await expect(model.getResponseFromAI([] as any)).rejects.toThrow('Cannot get AI response with empty message history.');
    });

    it('converts messages then queries chat', async () => {
      const model = new Gemini2ProModel(createMockConfig(MOCK_API_KEY));
      const convertSpy = jest.spyOn(model, 'convertToGeminiConversation').mockReturnValue([{ role: 'user', parts: [{ text: 'q' }] }]);
      const querySpy = jest.spyOn(model, 'queryGeminiChat').mockResolvedValue('resp');
      const messages = [{ role: 'user', content: 'hi' }];
      const result = await model.getResponseFromAI(messages as any);
      expect(convertSpy).toHaveBeenCalledWith(messages as any);
      expect(querySpy).toHaveBeenCalledWith([{ role: 'user', parts: [{ text: 'q' }] }]);
      expect(result).toBe('resp');
    });
  });

  describe('queryGeminiChat', () => {
    let model: Gemini2ProModel;
    beforeEach(() => {
      jest.clearAllMocks();
      mockSendMessage.mockResolvedValue({ response: { text: () => 'ok' } });
      model = new Gemini2ProModel(createMockConfig(MOCK_API_KEY));
    });

    it('sends prompt directly when interactive review disabled', async () => {
      const convo = [
        { role: 'user', parts: [{ text: 'a' }] }
      ];
      const res = await model.queryGeminiChat(convo as any);
      expect(mockStartChat).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('a');
      expect(res).toBe('ok');
    });

    it('handles interactive review', async () => {
      const config = createMockConfig(MOCK_API_KEY);
      config.gemini.interactive_prompt_review = true;
      mockReviewPrompt.mockResolvedValue('edited');
      model = new Gemini2ProModel(config);
      await model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any);
      expect(mockReviewPrompt).toHaveBeenCalledWith('a');
      expect(mockSendMessage).toHaveBeenCalledWith('edited');
    });

    it('returns empty string when user cancels', async () => {
      const config = createMockConfig(MOCK_API_KEY);
      config.gemini.interactive_prompt_review = true;
      mockReviewPrompt.mockResolvedValue(null);
      model = new Gemini2ProModel(config);
      const res = await model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any);
      expect(res).toBe('');
    });

    it('calls handleError on sendMessage failure', async () => {
      const err = new Error('boom');
      mockSendMessage.mockRejectedValue(err);
      model = new Gemini2ProModel(createMockConfig(MOCK_API_KEY));
      const handleSpy = jest.spyOn(model, 'handleError').mockImplementation(() => {});
      const res = await model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any);
      expect(handleSpy).toHaveBeenCalledWith(err, 'gemini-pro');
      expect(res).toBe('');
    });
  });

  describe('handleError', () => {
    let model: Gemini2ProModel;
    beforeEach(() => {
      model = new Gemini2ProModel(createMockConfig(MOCK_API_KEY));
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

  describe('constructor error handling', () => {
    it('throws when generative model cannot be created', () => {
      mockGetGenerativeModel.mockImplementation(() => { throw new Error('bad'); });
      const cfg = createMockConfig(MOCK_API_KEY);
      expect(() => new Gemini2ProModel(cfg)).toThrow('Failed to get generative model for gemini-pro');
    });
  });

  describe('queryGeminiChat error paths', () => {
    it('handles missing content error via handleError', async () => {
      const model = new Gemini2ProModel(createMockConfig(MOCK_API_KEY));
      mockSendMessage.mockResolvedValue({ response: {} });
      await expect(model.queryGeminiChat([{ role: 'user', parts: [{ text: 'a' }] }] as any)).rejects.toThrow(/AI API Error/);
    });

    it('propagates safety block reason', async () => {
      const model = new Gemini2ProModel(createMockConfig(MOCK_API_KEY));
      mockSendMessage.mockResolvedValue({ response: { candidates: [{ finishReason: FinishReason.SAFETY, safetyRatings: { score: 1 } }] } });
      await expect(model.queryGeminiChat([{ role: 'user', parts: [{ text: 'x' }] }] as any)).rejects.toThrow(/SAFETY/);
    });
  });

  describe('generateContent edge cases', () => {
    let model: Gemini2ProModel;
    beforeEach(() => {
      jest.clearAllMocks();
      mockResponseText.mockReturnValue('done');
      mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent, startChat: mockStartChat });
      model = new Gemini2ProModel(createMockConfig(MOCK_API_KEY));
    });

    it('throws when result missing', async () => {
      mockGenerateContent.mockResolvedValue({});
      await expect(model.generateContent(MOCK_GENERATE_CONTENT_REQUEST)).rejects.toThrow(/unexpectedly empty/);
    });

    it('throws block error on safety finishReason', async () => {
      mockGenerateContent.mockResolvedValue({ response: { candidates: [{ finishReason: FinishReason.SAFETY, safetyRatings: {flag:true} }] } });
      await expect(model.generateContent(MOCK_GENERATE_CONTENT_REQUEST)).rejects.toThrow(/generation blocked/);
    });

    it('warns when no text with stop reason', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockGenerateContent.mockResolvedValue({ response: { candidates: [{ finishReason: FinishReason.STOP, content: { parts: [] } }] } });
      await model.generateContent(MOCK_GENERATE_CONTENT_REQUEST);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('produced no text'));
      warn.mockRestore();
    });

    it('retries on network error then succeeds', async () => {
      jest.spyOn(global.Math, 'random').mockReturnValue(0);
      const cfg = createMockConfig(MOCK_API_KEY);
      cfg.gemini.generation_max_retries = 1;
      cfg.gemini.generation_retry_base_delay_ms = 0;
      mockGenerateContent
        .mockRejectedValueOnce(Object.assign(new Error('ECONNRESET'), { message: 'ECONNRESET' }))
        .mockResolvedValueOnce({ response: { text: () => 'hi' } });
      model = new Gemini2ProModel(cfg);
      const result = await model.generateContent(MOCK_GENERATE_CONTENT_REQUEST);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(result.response.text()).toBe('hi');
    });
  });
});
