import { ConsolidationAnalyzer } from './ConsolidationAnalyzer';
import { AIClient } from '../AIClient'; // Import AIClient
import { Message } from '../models/Conversation'; // Import Message

// Mock AIClient
jest.mock('../AIClient');

// Mock console methods to suppress output during tests
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

describe('ConsolidationAnalyzer', () => {
  let analyzer: ConsolidationAnalyzer;
  let mockAIClient: jest.Mocked<AIClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAIClient = new AIClient({} as any) as jest.Mocked<AIClient>; // Create a mock AIClient instance
    // Mock getResponseTextFromAI for the AIClient
    mockAIClient.getResponseTextFromAI.mockResolvedValue(JSON.stringify({ operations: [] }));
    analyzer = new ConsolidationAnalyzer(mockAIClient); // Pass the mock AIClient
    expect(analyzer).toBeDefined();
  });

  it('should be defined', () => {
    // Already covered in beforeEach
  });

  it('should return an empty operations array when AI returns empty operations', async () => {
    mockAIClient.getResponseTextFromAI.mockResolvedValueOnce(JSON.stringify({ operations: [] }));
    const result = await analyzer.analyze([], 'mock_context', '/path/conv.jsonl', false, 'mock_model');
    expect(result).toEqual({ operations: [] });
    expect(mockAIClient.getResponseTextTextFromAI).toHaveBeenCalledTimes(1);
  });

  it('should analyze a small array of items and return operations from AI', async () => {
    const items = [{ id: 1, name: 'Item A' }, { id: 2, name: 'Item B' }];
    const mockOperations = [
        { filePath: 'src/file1.ts', action: 'CREATE' },
        { filePath: 'src/file2.ts', action: 'MODIFY' },
    ];
    mockAIClient.getResponseTextFromAI.mockResolvedValueOnce(JSON.stringify({ operations: mockOperations }));

    const result = await analyzer.analyze(items as unknown as Message[], 'mock_context', '/path/conv.jsonl', false, 'mock_model');
    expect(result.operations.length).toBe(2);
    expect(result.operations).toEqual(mockOperations);
    expect(mockAIClient.getResponseTextFromAI).toHaveBeenCalledTimes(1);
  });
});