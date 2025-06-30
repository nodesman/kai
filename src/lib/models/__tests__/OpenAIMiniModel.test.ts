import OpenAIMiniModel from '../OpenAIMiniModel';
import { Config } from '../../Config';
import { OpenAI } from 'openai';

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } }
  }))
}));

describe('OpenAIMiniModel', () => {
  const baseConfig = { openai: { api_key: 'k', model_name: 'gpt-3.5-turbo' } } as unknown as Config;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when api key missing', () => {
    expect(() => new OpenAIMiniModel({} as Config)).toThrow('OpenAI API key is missing');
  });

  it('initializes with api key', () => {
    const model = new OpenAIMiniModel(baseConfig);
    expect(model).toBeDefined();
    expect(OpenAI).toHaveBeenCalled();
  });

  it('returns text from API', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'hi' } }] });
    const model = new OpenAIMiniModel(baseConfig);
    const res = await model.getResponseFromAI([{ role: 'user', content: 'q' }]);
    expect(mockCreate).toHaveBeenCalled();
    expect(res).toBe('hi');
  });

  it('throws when API returns no content', async () => {
    mockCreate.mockResolvedValue({ choices: [] });
    const model = new OpenAIMiniModel(baseConfig);
    await expect(model.getResponseFromAI([{ role: 'user', content: 'q' }])).rejects.toThrow('OpenAI response missing');
  });

  it('propagates API errors', async () => {
    mockCreate.mockRejectedValue(new Error('fail'));
    const model = new OpenAIMiniModel(baseConfig);
    await expect(model.getResponseFromAI([{ role: 'user', content: 'q' }])).rejects.toThrow('fail');
  });
});
