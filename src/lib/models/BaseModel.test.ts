import BaseModel from './BaseModel';

describe('BaseModel', () => {
  it('stores the provided config', () => {
    const config = {foo: 'bar'};
    const model = new BaseModel(config as any);
    expect(model.config).toBe(config);
  });

  it('getResponseFromAI throws an error by default', async () => {
    const model = new BaseModel({});
    await expect(model.getResponseFromAI({})).rejects.toThrow(
      'getResponseFromAI must be implemented in derived classes'
    );
  });

  describe('flattenMessages', () => {
    it('logs an error and returns empty array when input is not an array', () => {
      const model = new BaseModel({});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = model.flattenMessages('bad' as any);
      expect(errorSpy).toHaveBeenCalledWith(
        'flattenMessages expects an array of messages.'
      );
      expect(result).toEqual([]);
      errorSpy.mockRestore();
    });

    it('filters out messages without required structure', () => {
      const model = new BaseModel({});
      const valid1 = { role: 'user', parts: [{ text: 'hello' }] };
      const valid2 = { role: 'bot', parts: [{ text: 'hi' }] };
      const messages = [
        valid1,
        { role: 'missingParts' },
        { role: 'badText', parts: [{ text: 123 }] },
        valid2,
      ];
      const result = model.flattenMessages(messages as any);
      expect(result).toEqual([valid1, valid2]);
    });
  });
});
