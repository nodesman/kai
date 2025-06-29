import { GoogleGenerativeAI, GenerateContentRequest, Content } from '@google/generative-ai';
import { Config } from '../Config'; // Import Config for type reference
import Gemini2ProModel from './Gemini2ProModel';

// --- Mocks for @google/generative-ai ---
// Using 'var' for top-level mocks referenced in jest.mock to avoid ReferenceError
// due to hoisting behavior differences between 'const'/'let' and 'var'.
var mockResponseText = jest.fn();
var mockResponse = { text: mockResponseText };

var mockGenerateContent = jest.fn();
var mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
}));

var mockGoogleGenerativeAI = jest.fn((apiKey: string) => ({
  getGenerativeModel: mockGetGenerativeModel,
}));

// Apply the mock to the @google/generative-ai module
// This ensures that any instantiation of GoogleGenerativeAI within Gemini2ProModel
// uses our mock instead of the actual library.
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: mockGoogleGenerativeAI,
}));
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

describe('Gemini2ProModel', () => {
  const MOCK_API_KEY = 'test-api-key';
  const MOCK_PROMPT = 'Hello, Gemini!';
  const MOCK_GENERATED_TEXT = 'Hello from Gemini!';

  beforeEach(() => {
    jest.clearAllMocks(); // Clears all call histories and mock return values
    // Re-set the return value for mockGetGenerativeModel because clearAllMocks would clear it
    mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent });
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
    expect(mockGoogleGenerativeAI).not.toHaveBeenCalled(); // Ensure the client is not instantiated
  });

  it('should initialize with provided API key and default model name', () => {
    // This covers the default model name assignment branch
    const mockConfigInstance = createMockConfig(MOCK_API_KEY, 'gemini-pro'); // Default name
    const model = new Gemini2ProModel(mockConfigInstance);
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith(MOCK_API_KEY);
  });

  it('should initialize with provided API key and a custom model name', () => {
    const customModelName = 'my-custom-gemini-model';
    // This covers the custom model name assignment branch
    const customConfigInstance = createMockConfig(MOCK_API_KEY, customModelName);
    const model = new Gemini2ProModel(customConfigInstance);
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith(MOCK_API_KEY);
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
      // Re-initialize the model for each 'generateContent' test to ensure a clean state
      defaultMockConfig = createMockConfig(MOCK_API_KEY, 'gemini-pro');
      model = new Gemini2ProModel(defaultMockConfig);
      jest.clearAllMocks(); // Clear mocks for the new model instance

      // Reset mock implementations for the generation process
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: Promise.resolve(mockResponse) });
      mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent }); // Ensure it's set for this test
    });

    it('should call the Gemini API with the default model and return the generated text', async () => {
      const expectedModelName = defaultMockConfig.gemini.model_name;
      const result = await model.generateContent(MOCK_GENERATE_CONTENT_REQUEST);

      // Assert that the correct methods on the mock client were called
      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: expectedModelName });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(MOCK_GENERATE_CONTENT_REQUEST);
      expect(mockResponseText).toHaveBeenCalledTimes(1);
      expect(result.response?.text()).toBe(MOCK_GENERATED_TEXT); // Check actual text content
    });

    it('should call the Gemini API with a custom model and return the generated text', async () => {
      const customModelName = 'my-custom-gemini-model';
      const customConfigInstance = createMockConfig(MOCK_API_KEY, customModelName);
      model = new Gemini2ProModel(customConfigInstance);
      jest.clearAllMocks(); // Clear mocks again after model instantiation

      // Reset generateContent related mocks
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: Promise.resolve(mockResponse) });
      mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent }); // Ensure it's set for this test

      const result = await model.generateContent(MOCK_GENERATE_CONTENT_REQUEST);

      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: customModelName });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(MOCK_GENERATE_CONTENT_REQUEST);
      expect(mockResponseText).toHaveBeenCalledTimes(1);
      expect(result.response?.text()).toBe(MOCK_GENERATED_TEXT); // Check actual text content
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