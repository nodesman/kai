import { CodeProcessor } from '../CodeProcessor';
import { Config } from '../Config';
import { FileSystem } from '../FileSystem';
import { CommandService } from '../CommandService';
import { GitService } from '../GitService';
import { UserInterface } from '../UserInterface';
import { ProjectContextBuilder } from '../ProjectContextBuilder';
import { AIClient } from '../AIClient';
import { ConsolidationService } from '../consolidation/ConsolidationService';
import { ConversationManager } from '../ConversationManager';
import { CommitMessageService } from '../CommitMessageService';
import Conversation, { Message } from '../models/Conversation';
import { CONSOLIDATION_SUCCESS_MARKER } from '../consolidation/constants';

// Mock all dependencies
jest.mock('../FileSystem');
jest.mock('../CommandService');
jest.mock('../GitService');
jest.mock('../UserInterface');
jest.mock('../ProjectContextBuilder');
jest.mock('../AIClient');
jest.mock('../consolidation/ConsolidationService');
jest.mock('../ConversationManager');
jest.mock('../CommitMessageService');

// Suppress console output for cleaner test runs
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'info').mockImplementation(() => {});

describe('CodeProcessor', () => {
    let mockConfig: Config;
    let mockFs: jest.Mocked<FileSystem>;
    let mockCommandService: jest.Mocked<CommandService>;
    let mockGitService: jest.Mocked<GitService>;
    let mockUi: jest.Mocked<UserInterface>;
    let mockContextBuilder: jest.Mocked<ProjectContextBuilder>;
    let mockAIClient: jest.Mocked<AIClient>;
    let mockConsolidationService: jest.Mocked<ConsolidationService>;
    let mockConversationManager: jest.Mocked<ConversationManager>;
    let mockCommitMessageService: jest.Mocked<CommitMessageService>;

    let codeProcessor: CodeProcessor;

    beforeEach(() => {
        jest.clearAllMocks();

        // Instantiate mocks
        mockConfig = {
            gemini: {
                api_key: 'key',
                model_name: 'model',
                subsequent_chat_model_name: 'flash',
                max_output_tokens: 100,
                max_prompt_tokens: 100,
            },
            project: {
                root_dir: 'root',
                prompts_dir: 'prompts',
                prompt_template: 'tpl',
                chats_dir: '.kai/logs',
                typescript_autofix: false,
                autofix_iterations: 3,
            },
            analysis: { cache_file_path: '.kai/project_analysis.json' },
            context: { mode: 'full' },
            chatsDir: '/project/.kai/logs'
        } as unknown as Config;
        mockFs = new FileSystem() as jest.Mocked<FileSystem>;
        mockCommandService = new CommandService() as jest.Mocked<CommandService>;
        mockGitService = new GitService(mockCommandService, mockFs) as jest.Mocked<GitService>;
        mockUi = new UserInterface(mockConfig) as jest.Mocked<UserInterface>;
        mockContextBuilder = new ProjectContextBuilder(mockFs, mockGitService, '/project', mockConfig, new AIClient(mockConfig)) as jest.Mocked<ProjectContextBuilder>;
        mockAIClient = new AIClient(mockConfig) as jest.Mocked<AIClient>;
        mockConsolidationService = new ConsolidationService(mockConfig, mockFs, mockAIClient, '/project', mockGitService, mockUi, new CommitMessageService(mockAIClient, mockGitService, 100)) as jest.Mocked<ConsolidationService>;
        mockConversationManager = new ConversationManager(mockConfig, mockFs, mockAIClient, mockUi, mockContextBuilder, mockConsolidationService) as jest.Mocked<ConversationManager>;
        mockCommitMessageService = new CommitMessageService(mockAIClient, mockGitService, 100) as jest.Mocked<CommitMessageService>;

        // Setup mock implementations for sub-dependencies that CodeProcessor instantiates
        (AIClient as jest.Mock).mockImplementation(() => mockAIClient);
        (CommitMessageService as jest.Mock).mockImplementation(() => mockCommitMessageService);
        (ConsolidationService as jest.Mock).mockImplementation(() => mockConsolidationService);
        (ConversationManager as jest.Mock).mockImplementation(() => mockConversationManager);

        codeProcessor = new CodeProcessor(
            mockConfig,
            mockFs,
            mockCommandService,
            mockGitService,
            mockUi,
            mockContextBuilder
        );
    });

    it('should be created and initialize its dependencies', () => {
        expect(codeProcessor).toBeDefined();
        expect((codeProcessor as any).config).toBe(mockConfig);
        expect((codeProcessor as any).fs).toBe(mockFs);
        expect((codeProcessor as any).commandService).toBe(mockCommandService);
        expect((codeProcessor as any).gitService).toBe(mockGitService);
        expect((codeProcessor as any).ui).toBe(mockUi);
        expect((codeProcessor as any).contextBuilder).toBe(mockContextBuilder);
        expect((codeProcessor as any).aiClient).toBe(mockAIClient); // Should be the mocked instance
        expect((codeProcessor as any).commitMessageService).toBe(mockCommitMessageService);
        expect((codeProcessor as any).consolidationService).toBe(mockConsolidationService);
        expect((codeProcessor as any).conversationManager).toBe(mockConversationManager);

        expect(AIClient).toHaveBeenCalledWith(mockConfig);
        expect(CommitMessageService).toHaveBeenCalledWith(mockAIClient, mockGitService, mockConfig.gemini.max_prompt_tokens);
        expect(ConsolidationService).toHaveBeenCalledWith(mockConfig, mockFs, mockAIClient, process.cwd(), mockGitService, mockUi, mockCommitMessageService, expect.any(Array));
        expect(ConversationManager).toHaveBeenCalledWith(mockConfig, mockFs, mockAIClient, mockUi, mockContextBuilder, mockConsolidationService);
    });

    describe('startConversation', () => {
        it('should delegate to conversationManager.runSession', async () => {
            const convName = 'test-conv';
            const isNew = true;
            await codeProcessor.startConversation(convName, isNew);
            expect(mockConversationManager.runSession).toHaveBeenCalledWith(convName, isNew);
        });
    });

    describe('processConsolidationRequest', () => {
        const convName = 'test-conv';
        const convFilePath = `/project/.kai/logs/${convName}.jsonl`;
        const mockConversation = new Conversation();
        mockConversation.addMessage('user', 'initial prompt');

        beforeEach(() => {
            mockFs.readJsonlFile.mockResolvedValue([{ type: 'request', role: 'user', content: 'initial prompt', timestamp: '2023' }]);
            mockContextBuilder.buildContext.mockResolvedValue({ context: 'mock_context', tokenCount: 100 });
            mockConfig.context.mode = 'full'; // Default mode for simplicity
        });

        it('should load conversation and delegate to consolidationService.process', async () => {
            await codeProcessor.processConsolidationRequest(convName);
            expect(mockFs.readJsonlFile).toHaveBeenCalledWith(expect.stringContaining('testconv'));
            expect(mockContextBuilder.buildContext).toHaveBeenCalled();
            expect(mockConsolidationService.process).toHaveBeenCalledWith(convName, expect.any(Conversation), 'mock_context', expect.stringContaining('testconv'));
        });

        it('should warn and exit if conversation is empty', async () => {
            mockFs.readJsonlFile.mockResolvedValueOnce([]); // Empty conversation
            await codeProcessor.processConsolidationRequest(convName);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Conversation is empty, cannot consolidate.'));
            expect(mockConsolidationService.process).not.toHaveBeenCalled();
        });

        it('should handle errors during consolidation setup', async () => {
            mockFs.readJsonlFile.mockRejectedValue(new Error('File read error'));
            await codeProcessor.processConsolidationRequest(convName);
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error triggering consolidation process'), expect.any(Error));
            expect(mockAIClient.logConversation).toHaveBeenCalledWith(
                expect.stringContaining('testconv'),
                expect.objectContaining({ type: 'error', role: 'system', error: expect.stringContaining('File read error') })
            );
        });

        it('should build dynamic context if mode is dynamic', async () => {
            mockConfig.context.mode = 'dynamic';
            mockContextBuilder.buildDynamicContext.mockResolvedValueOnce({ context: 'dynamic_context', tokenCount: 200 });
            await codeProcessor.processConsolidationRequest(convName);
            expect(mockContextBuilder.buildDynamicContext).toHaveBeenCalledWith(
                'Consolidate recent conversation changes',
                expect.stringContaining('initial prompt') // Should contain summary of relevant history
            );
            expect(mockConsolidationService.process).toHaveBeenCalledWith(convName, expect.any(Conversation), 'dynamic_context', expect.stringContaining('testconv'));
        });
    });

    describe('updateAIClient', () => {
        it('should update its own AI client and propagate to manager and service', () => {
            const newAIClient = new AIClient(mockConfig) as jest.Mocked<AIClient>;
            codeProcessor.updateAIClient(newAIClient);
            expect((codeProcessor as any).aiClient).toBe(newAIClient);
            expect(mockConversationManager.updateAIClient).toHaveBeenCalledWith(newAIClient);
            expect(mockConsolidationService.updateAIClient).toHaveBeenCalledWith(newAIClient);
        });
    });

    describe('_findRelevantHistorySlice', () => {
        it('should return messages after the last success marker', () => {
            const conv = new Conversation();
            conv.addMessage('user', 'msg1');
            conv.addMessage('system', CONSOLIDATION_SUCCESS_MARKER);
            conv.addMessage('user', 'msg2');
            conv.addMessage('assistant', 'msg3');
            conv.addMessage('system', 'another marker'); // Not the official one
            conv.addMessage('user', 'msg4');

            const relevant = (codeProcessor as any)._findRelevantHistorySlice(conv);
            expect(relevant.map((m: Message) => m.content)).toEqual(['msg2', 'msg3', 'another marker', 'msg4']);
        });

        it('should return all messages if no success marker is found', () => {
            const conv = new Conversation();
            conv.addMessage('user', 'msg1');
            conv.addMessage('assistant', 'msg2');

            const relevant = (codeProcessor as any)._findRelevantHistorySlice(conv);
            expect(relevant.map((m: Message) => m.content)).toEqual(['msg1', 'msg2']);
        });

        it('should return empty array for empty conversation', () => {
            const conv = new Conversation();
            const relevant = (codeProcessor as any)._findRelevantHistorySlice(conv);
            expect(relevant).toEqual([]);
        });
    });

    describe('_summarizeHistory', () => {
        it('should return null for empty history', () => {
            expect((codeProcessor as any)._summarizeHistory([])).toBeNull();
        });

        it('should summarize recent messages', () => {
            const history: Message[] = [
                { role: 'user', content: 'old 1', timestamp: '' },
                { role: 'assistant', content: 'old 2', timestamp: '', },
                { role: 'user', content: 'recent 1', timestamp: '' },
                { role: 'assistant', content: 'recent 2', timestamp: '' },
                { role: 'user', content: 'recent 3', timestamp: '' },
                { role: 'assistant', content: 'recent 4', timestamp: '' },
            ];
            const summary = (codeProcessor as any)._summarizeHistory(history);
            expect(summary).toContain('Recent conversation highlights:');
            expect(summary).toContain('user: recent 1');
            expect(summary).toContain('assistant: recent 4');
            expect(summary).not.toContain('old 1'); // Should only take last 4
        });
    });

    describe('optimizeWhitespace', () => {
        it('should remove trailing whitespace', () => {
            expect(codeProcessor.optimizeWhitespace('line1   \nline2\t\n')).toBe('line1\nline2');
        });

        it('should replace multiple newlines with two', () => {
            expect(codeProcessor.optimizeWhitespace('line1\n\n\nline2\n\n\n\nline3')).toBe('line1\n\nline2\n\nline3');
        });

        it('should trim overall string', () => {
            expect(codeProcessor.optimizeWhitespace('  start\nend  ')).toBe('start\nend');
        });

        it('should handle empty string', () => {
            expect(codeProcessor.optimizeWhitespace('')).toBe('');
        });

        it('should handle mixed newlines', () => {
            expect(codeProcessor.optimizeWhitespace('line1\r\nline2\nline3')).toBe('line1\nline2\nline3');
        });
    });
});