import OpenAIChatModel from '../OpenAIChatModel';
import { Config } from '../../Config';

const mockCreate = jest.fn();
const mockOpenAIConstructor = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: class {
      chat = { completions: { create: mockCreate } };
      constructor(opts: any) { mockOpenAIConstructor(opts.apiKey); }
    }
  };
});

describe('OpenAIChatModel', () => {
  const baseConfig: any = {
    openai: { api_key: 'k', max_prompt_tokens: 5, max_output_tokens: 10 },
    gemini: {
      api_key: 'g',
      model_name: 'm',
      subsequent_chat_model_name: 'm2',
      max_output_tokens: 1,
      max_prompt_tokens: 1
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
  });

  it('throws without API key', () => {
    const cfg = { ...baseConfig, openai: { api_key: '' } } as Config;
    expect(() => new OpenAIChatModel(cfg, 'gpt-4o')).toThrow('OpenAI API key is missing');
  });

  it('calls OpenAI with messages', async () => {
    const model = new OpenAIChatModel(baseConfig as Config, 'gpt-4o');
    await model.getResponseFromAI([{ role: 'user', content: 'hi' }]);
    expect(mockOpenAIConstructor).toHaveBeenCalledWith('k');
    expect(mockCreate).toHaveBeenCalled();
  });

  it('splits long prompts', async () => {
    const model = new OpenAIChatModel(baseConfig as Config, 'gpt-4o');
    const long = 'a'.repeat(100);
    await model.getResponseFromAI([{ role: 'user', content: long }]);
    expect(mockCreate.mock.calls.length).toBeGreaterThan(1);
  });
});
