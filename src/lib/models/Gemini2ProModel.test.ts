import { GoogleGenerativeAI, GenerateContentRequest, Content } from '@google/generative-ai';
import { Config } from '../Config'; // Import Config for type reference
import Gemini2ProModel from './Gemini2ProModel'; // Assuming this path to your model file

// --- Mocks for @google/generative-ai ---
// Create mock functions for the API response components
const mockResponseText = jest.fn();
const mockResponse = { text: mockResponseText };

// The generateContent method returns a result object with an async 'response' property
// that resolves to the mockResponse.
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
}));
const mockGoogleGenerativeAI = jest.fn(() => ({
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
  // Define a basic mock for the Config class's instance properties and methods
  // This structure must match IConfig and also include the methods of ConfigLoader
  class MockConfig {
    gemini: any; // Using any for simplicity in mock, could be more specific
    project: any;
    analysis: any;
    context: any;
    chatsDir: string;

    constructor(initialData?: any) {
      this.gemini = {
        api_key: initialData?.gemini?.api_key || 'mock-api-key',
        model_name: initialData?.gemini?.model_name || 'gemini-pro',
        subsequent_chat_model_name: initialData?.gemini?.subsequent_chat_model_name || 'gemini-flash',
        max_output_tokens: initialData?.gemini?.max_output_tokens || 8192,
        max_prompt_tokens: initialData?.gemini?.max_prompt_tokens || 32000,
        generation_max_retries: initialData?.gemini?.generation_max_retries || 3,
        generation_retry_base_delay_ms: initialData?.gemini?.generation_retry_base_delay_ms || 2000,
        interactive_prompt_review: initialData?.gemini?.interactive_prompt_review || false,
        rate_limit: initialData?.gemini?.rate_limit || { requests_per_minute: 60 }
      };
      this.project = initialData?.project || { root_dir: '.', prompts_dir: 'prompts', prompt_template: 'prompt.yaml', chats_dir: '.kai/logs', typescript_autofix: false, autofix_iterations: 3, coverage_iterations: 3 };
      this.analysis = initialData?.analysis || { cache_file_path: '.kai/project_analysis.json' };
      this.context = initialData?.context || { mode: 'full' };
      this.chatsDir = initialData?.chatsDir || '/mock/kai/logs';

      // Mock methods
      this.saveConfig = jest.fn();
      this.loadConfig = jest.fn(() => this); // loadConfig should return the config itself, or a new loaded version
      this.getConfigFilePath = jest.fn(() => '/mock/kai/config.yaml');
    }
  }
  return {
    Config: MockConfig,
  };
});


describe('Gemini2ProModel', () => {
  const MOCK_API_KEY = 'test-api-key';
  const MOCK_PROMPT = 'Hello, Gemini!'; // This is just the content string, not the request object
  const MOCK_GENERATED_TEXT = 'Hello from Gemini!';

  // Define the GenerateContentRequest for the tests
  const MOCK_GENERATE_CONTENT_REQUEST: GenerateContentRequest = { contents: [{ role: 'user', parts: [{ text: MOCK_PROMPT }] }] };

  let mockConfigInstance: Config; // Declare a variable for the mocked Config instance

  beforeEach(() => {
    // Clear all mocks before each test to ensure isolation and prevent test pollution
    jest.clearAllMocks();

    // Instantiate the mocked Config class for each test
    // This `new Config()` will now call the MockConfig constructor from the jest.mock block above.
    mockConfigInstance = new Config({
      gemini: { api_key: MOCK_API_KEY, model_name: 'gemini-pro', subsequent_chat_model_name: 'gemini-flash' },
      chatsDir: '/mock/kai/logs',
    });

    // Reset mock implementations to their default success paths
    mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
    // Simulate the async nature of the API response chain
    mockGenerateContent.mockResolvedValue({ response: mockResponse });
  });

  // --- Constructor Tests ---
  it('should throw an error if API key is not provided in the config', () => {
    // This test covers the validation branch inside the constructor
    const configWithoutApiKey = new Config({ gemini: { api_key: '' } });
    expect(() => new Gemini2ProModel(configWithoutApiKey)).toThrow('Gemini API key is missing in the configuration.');
    expect(mockGoogleGenerativeAI).not.toHaveBeenCalled(); // Ensure the client is not instantiated
  });

  it('should initialize with provided API key and default model name', () => {
    // Pass the mocked Config instance
    const model = new Gemini2ProModel(mockConfigInstance);
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith(MOCK_API_KEY);
  });

  it('should initialize with provided API key and a custom model name', () => {
    const customModelName = 'my-custom-gemini-model';
    // Create a new mocked Config instance with a custom model name for this specific test
    const customConfigInstance = new Config({
      gemini: { api_key: MOCK_API_KEY, model_name: customModelName, subsequent_chat_model_name: 'gemini-flash' },
      chatsDir: '/mock/kai/logs',
    });
    const model = new Gemini2ProModel(customConfigInstance);
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith(MOCK_API_KEY);
  });

  // --- generateContent Method Tests ---
  describe('generateContent', () => {
    let model: Gemini2ProModel;

    beforeEach(() => {
      // Re-initialize the model for each 'generateContent' test to ensure a clean state
      // Use the mockConfigInstance from the outer beforeEach
      model = new Gemini2ProModel(mockConfigInstance);
      // Clear mocks again after model instantiation to only track calls made within 'generateContent' method
      jest.clearAllMocks();
      // Reset mock implementations for the generation process
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: mockResponse });
    });

    it('should call the Gemini API with the default model and return the generated text', async () => {
      const expectedModelName = mockConfigInstance.gemini.model_name; // Get model name from the mocked config
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
      // Create a new mocked Config instance with a custom model name for this specific test
      const customConfigInstance = new Config({
        gemini: { api_key: MOCK_API_KEY, model_name: customModelName, subsequent_chat_model_name: 'gemini-flash' },
        chatsDir: '/mock/kai/logs',
      });
      model = new Gemini2ProModel(customConfigInstance); // Use the custom config
      jest.clearAllMocks(); // Clear mocks again after model instantiation

      // Reset generateContent related mocks
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: mockResponse });

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
      await expect(model.generateContent(MOCK_GENERATE_CONTENT_REQUEST)).rejects.toThrow(`AI API Error (UNKNOWN) using ${mockConfigInstance.gemini.model_name}: ${errorMessage}`);
      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockResponseText).not.toHaveBeenCalled();
    });
  });
});