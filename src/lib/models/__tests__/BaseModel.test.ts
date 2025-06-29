import BaseModel from '../BaseModel';

describe('BaseModel', () => {
    it('should be created', () => {
        const model = new BaseModel({});
        expect(model).toBeDefined();
    });
});