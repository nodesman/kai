import { AIClient, LogEntryData } from '../AIClient';
import { FileSystem } from '../FileSystem';
import { Config } from '../Config';
import Conversation, { Message } from '../models/Conversation';
import Gemini2ProModel from '../models/Gemini2ProModel';
import Gemini2FlashModel from '../models/Gemini2FlashModel';
import { HIDDEN_CONVERSATION_INSTRUCTION } from '../internal_prompts';

// Mock dependencies
jest.mock('../FileSystem');
jest.mock('../models/Gemini2ProModel');
jest.mock('../models/Gemini2FlashModel');
jest.mock('../Config'); // Mock Config if not using a concrete instance, but here we pass a mock object

// Suppress console output for cleaner test runs
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

const mockConfig = {
    gemini: {
        api_key: 'test-key',
        model_name: 'gemini-test-pro',
        subsequent_chat_model_name: 'gemini-test-flash',
        max_output_tokens: 100,
        max_prompt_tokens: 1000,
    },
    chatsDir: '/test/chats',
} as unknown as Config; // Cast as Config for type compatibility

const mockProModelInstance = {
    getResponseFromAI: jest.fn(),
    generateContent: jest.fn(),
    modelName: 'gemini-test-pro'
};
const mockFlashModelInstance = {
    getResponseFromAI: jest.fn(),
    generateContent: jest.fn(),
    modelName: 'gemini-test-flash'
};

(Gemini2ProModel as jest.Mock).mockImplementation(() => mockProModelInstance);
(Gemini2FlashModel as jest.Mock).mockImplementation(() => mockFlashModelInstance);

describe('AIClient', () => {
    let aiClient: AIClient;
    let mockFs: jest.Mocked<FileSystem>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFs = new FileSystem() as jest.Mocked<FileSystem>;
        aiClient = new AIClient(mockConfig);
        // Ensure the internal instances are the mocked ones
        (aiClient as any).proModel = mockProModelInstance;
        (aiClient as any).flashModel = mockFlashModelInstance;
        (aiClient as any).fs = mockFs;
    });

    it('should be created and initialize models', () => {
        expect(aiClient).toBeDefined();
        expect(Gemini2ProModel).toHaveBeenCalledWith(mockConfig);
        expect(Gemini2FlashModel).toHaveBeenCalledWith(mockConfig);
    });

    it('should log conversation entries', async () => {
        const conversationFilePath = '/test/chats/conv.jsonl';
        const entryData: LogEntryData = { type: 'request', role: 'user', content: 'hello' }; // Explicitly type entryData
        await aiClient.logConversation(conversationFilePath, entryData);

        expect(mockFs.appendJsonlFile).toHaveBeenCalledTimes(1);
        const loggedData = mockFs.appendJsonlFile.mock.calls[0][1];
        expect(loggedData).toMatchObject(entryData);
        expect(loggedData).toHaveProperty('timestamp');
    });

    describe('getResponseFromAI (Chat Method)', () => {
        const conversationFilePath = '/test/chats/conv.jsonl';
        const userMessageContent = 'User query';
        const aiResponseContent = 'AI response';
        const mockConversation = new Conversation();
        mockConversation.addMessage('user', userMessageContent);

        beforeEach(() => {
            mockProModelInstance.getResponseFromAI.mockResolvedValue(aiResponseContent);
        });

        it('should prepend hidden instruction and context to the last user message', async () => {
            const contextString = 'This is some context.';
            await aiClient.getResponseFromAI(mockConversation, conversationFilePath, contextString);

            const expectedUserPrompt = `${HIDDEN_CONVERSATION_INSTRUCTION}\n\n---\n\nThis is the code base context:\n${contextString}\n\n---\nUser Question:\n${userMessageContent}`;
            const sentMessages = mockProModelInstance.getResponseFromAI.mock.calls[0][0];

            // The last message's content should include the prepended text
            expect(sentMessages[sentMessages.length - 1].content).toBe(expectedUserPrompt);
        });

        it('should use the Flash model if specified', async () => {
            await aiClient.getResponseFromAI(mockConversation, conversationFilePath, 'context', true);
            expect(mockFlashModelInstance.getResponseFromAI).toHaveBeenCalled();
            expect(mockProModelInstance.getResponseFromAI).not.toHaveBeenCalled();
        });

        it('should log the original user message and AI response', async () => {
            await aiClient.getResponseFromAI(mockConversation, conversationFilePath);
            expect(mockFs.appendJsonlFile).toHaveBeenCalledWith(conversationFilePath, expect.objectContaining({ type: 'request', role: 'user', content: userMessageContent }));
            expect(mockFs.appendJsonlFile).toHaveBeenCalledWith(conversationFilePath, expect.objectContaining({ type: 'response', role: 'assistant', content: aiResponseContent }));
        });

        it('should add AI response to the conversation object', async () => {
            await aiClient.getResponseFromAI(mockConversation, conversationFilePath);
            expect(mockConversation.getLastMessage()?.content).toBe(aiResponseContent);
            expect(mockConversation.getLastMessage()?.role).toBe('assistant');
        });

        it('should throw error if conversation history does not end with user message', async () => {
            const emptyConversation = new Conversation();
            await expect(aiClient.getResponseFromAI(emptyConversation, conversationFilePath)).rejects.toThrow("Conversation history must end with a user message.");
        });

        it('should handle errors from the model', async () => {
            mockProModelInstance.getResponseFromAI.mockRejectedValue(new Error('Model Error'));
            await expect(aiClient.getResponseFromAI(mockConversation, conversationFilePath)).rejects.toThrow('Model Error');
            expect(mockFs.appendJsonlFile).toHaveBeenCalledWith(conversationFilePath, expect.objectContaining({ type: 'error', role: 'system', error: expect.stringContaining('Model Error') }));
        });
    });

    describe('getResponseTextFromAI (Simple Text Method)', () => {
        const mockMessages: Message[] = [{ role: 'user', content: 'Generate code' }];
        const aiResponseContent = 'Generated code here';

        beforeEach(() => {
            mockFlashModelInstance.getResponseFromAI.mockResolvedValue(aiResponseContent);
        });

        it('should call the correct model and return response', async () => {
            const result = await aiClient.getResponseTextFromAI(mockMessages, true);
            expect(mockFlashModelInstance.getResponseFromAI).toHaveBeenCalledWith(mockMessages);
            expect(mockProModelInstance.getResponseFromAI).not.toHaveBeenCalled();
            expect(result).toBe(aiResponseContent);
        });

        it('should use Pro model if useFlashModel is false', async () => {
            mockProModelInstance.getResponseFromAI.mockResolvedValue(aiResponseContent);
            const result = await aiClient.getResponseTextFromAI(mockMessages, false);
            expect(mockProModelInstance.getResponseFromAI).toHaveBeenCalledWith(mockMessages);
            expect(mockFlashModelInstance.getResponseFromAI).not.toHaveBeenCalled();
            expect(result).toBe(aiResponseContent);
        });

        it('should throw error if messages are empty', async () => {
            await expect(aiClient.getResponseTextFromAI([])).rejects.toThrow("Cannot get raw AI response with empty message history.");
        });
    });

    describe('generateContent (Function Calling Method)', () => {
        const mockRequest = { contents: [] } as any;
        const mockResult = { response: { candidates: [{ content: { parts: [{ text: 'response' }] } }] } } as any;

        beforeEach(() => {
            mockProModelInstance.generateContent.mockResolvedValue(mockResult);
        });

        it('should call the correct model and return result', async () => {
            const result = await aiClient.generateContent(mockRequest, false);
            expect(mockProModelInstance.generateContent).toHaveBeenCalledWith(mockRequest);
            expect(mockFlashModelInstance.generateContent).not.toHaveBeenCalled();
            expect(result).toBe(mockResult);
        });

        it('should use Flash model if specified', async () => {
            const result = await aiClient.generateContent(mockRequest, true);
            expect(mockFlashModelInstance.generateContent).toHaveBeenCalledWith(mockRequest);
            expect(mockProModelInstance.generateContent).not.toHaveBeenCalled();
            expect(result).toBe(mockResult);
        });

        it('should handle errors from the model', async () => {
            mockProModelInstance.generateContent.mockRejectedValue(new Error('FC Model Error'));
            await expect(aiClient.generateContent(mockRequest)).rejects.toThrow('FC Model Error');
        });
    });
});