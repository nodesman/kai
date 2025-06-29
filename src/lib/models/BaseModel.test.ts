import BaseModel from './BaseModel';

describe('BaseModel', () => {
  it('should initialize with provided data', () => {
    const data = { id: 'testId1', name: 'Test Model One', value: 100 };
    const model = new BaseModel(data);

    expect(model).toBeDefined();
    expect(model.config).toEqual(data);
  });

  it('should initialize without data if none is provided', () => {
    const model = new BaseModel({});
    expect(model).toBeDefined();
    expect(model.config).toEqual({});
  });

  it('stores provided data in the config property', () => {
    const data = { id: 'testId2', description: 'A description for test model two' };
    const model = new BaseModel(data);
    expect(model.config).toEqual(data);
  });
});
