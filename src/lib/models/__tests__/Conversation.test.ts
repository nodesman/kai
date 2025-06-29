import Conversation from '../Conversation';

describe('Conversation', () => {
    it('should be created', () => {
        const conv = new Conversation();
        expect(conv).toBeDefined();
    });
});