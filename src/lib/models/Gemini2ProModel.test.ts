// Add an explicit import for GoogleGenerativeAI, even if it's mocked, for typing and clarity.
// The actual mocking happens via `jest.mock`.
import { GoogleGenerativeAI } from '@google/generative-ai';
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

describe('Gemini2ProModel', () => {
  const MOCK_API_KEY = 'test-api-key';
  const MOCK_PROMPT = 'Hello, Gemini!';
  const MOCK_GENERATED_TEXT = 'Hello from Gemini!';

  beforeEach(() => {
    // Clear all mocks before each test to ensure isolation and prevent test pollution
    jest.clearAllMocks();

    // Reset mock implementations to their default success paths
    mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
    // Simulate the async nature of the API response chain
    mockGenerateContent.mockResolvedValue({ response: Promise.resolve(mockResponse) });
  });

  // --- Constructor Tests ---
  it('should throw an error if API key is not provided', () => {
    // This test covers the validation branch inside the constructor
    expect(() => new Gemini2ProModel({ apiKey: '' })).toThrow('API key is required for Gemini2ProModel.');
    expect(mockGoogleGenerativeAI).not.toHaveBeenCalled(); // Ensure the client is not instantiated
  });

  it('should initialize with provided API key and default model name', () => {
    // This covers the default model name assignment branch
    const model = new Gemini2ProModel({ apiKey: MOCK_API_KEY });
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith(MOCK_API_KEY);
  });

  it('should initialize with provided API key and a custom model name', () => {
    // This covers the custom model name assignment branch
    const customModelName = 'my-custom-gemini-model';
    const model = new Gemini2ProModel({ apiKey: MOCK_API_KEY, modelName: customModelName });
    expect(model).toBeInstanceOf(Gemini2ProModel);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith(MOCK_API_KEY);
  });

  // --- generateContent Method Tests ---
  describe('generateContent', () => {
    let model: Gemini2ProModel;

    beforeEach(() => {
      // Re-initialize the model for each 'generateContent' test to ensure a clean state
      model = new Gemini2ProModel({ apiKey: MOCK_API_KEY });
      // Clear mocks again after model instantiation to only track calls made within 'generateContent' method
      jest.clearAllMocks();
      // Reset mock implementations for the generation process
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: Promise.resolve(mockResponse) });
    });

    it('should call the Gemini API with the default model and return the generated text', async () => {
      const expectedModelName = 'gemini-pro'; // Assuming 'gemini-pro' is the default in your model
      const content = await model.generateContent(MOCK_PROMPT);

      // Assert that the correct methods on the mock client were called
      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: expectedModelName });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(MOCK_PROMPT);
      expect(mockResponseText).toHaveBeenCalledTimes(1);
      expect(content).toBe(MOCK_GENERATED_TEXT);
    });

    it('should call the Gemini API with a custom model and return the generated text', async () => {
      const customModelName = 'my-custom-gemini-model';
      // Create a new model instance with a custom model name for this specific test
      model = new Gemini2ProModel({ apiKey: MOCK_API_KEY, modelName: customModelName });
      // Clear mocks from the constructor call above
      jest.clearAllMocks();

      // Reset generateContent related mocks
      mockResponseText.mockReturnValue(MOCK_GENERATED_TEXT);
      mockGenerateContent.mockResolvedValue({ response: Promise.resolve(mockResponse) });

      const content = await model.generateContent(MOCK_PROMPT);

      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: customModelName });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(MOCK_PROMPT);
      expect(mockResponseText).toHaveBeenCalledTimes(1);
      expect(content).toBe(MOCK_GENERATED_TEXT);
    });

    it('should handle errors from the Gemini API during content generation', async () => {
      const errorMessage = 'API error occurred during generation';
      // Simulate a rejected promise from generateContent
      mockGenerateContent.mockRejectedValue(new Error(errorMessage));

      // Expect the method to rethrow a wrapped error
      await expect(model.generateContent(MOCK_PROMPT)).rejects.toThrow(`Failed to generate content: ${errorMessage}`);
      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockResponseText).not.toHaveBeenCalled();
    });
  });
});
