import { BaseModel } from './BaseModel';

describe('BaseModel', () => {
  it('should initialize with provided data', () => {
    const data = { id: 'testId1', name: 'Test Model One', value: 100 };
    const model = new BaseModel(data);

    expect(model).toBeDefined();
    expect(model.id).toBe('testId1');
    expect(model.name).toBe('Test Model One');
    expect(model.value).toBe(100);
  });

  it('should initialize without data if none is provided', () => {
    const model = new BaseModel();
    expect(model).toBeDefined();
    // Assuming BaseModel doesn't set default 'id' or other properties unless explicitly passed
    expect(model.id).toBeUndefined();
  });

  it('should return a plain object representation using toJSON()', () => {
    const data = { id: 'testId2', description: 'A description for test model two' };
    const model = new BaseModel(data);

    const json = model.toJSON();
    expect(json).toEqual(data);
    expect(json).not.toBeInstanceOf(BaseModel); // Ensure it's a plain object, not an instance
    expect(typeof json).toBe('object');
  });
});
