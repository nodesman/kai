import Conversation, { JsonlLogEntry } from '../Conversation';
import { v4 as uuidv4 } from 'uuid';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'generated-id') }));

describe('Conversation', () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2020-01-01T00:00:00Z'));
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('generates an id when none is provided', () => {
        const conv = new Conversation();
        expect(uuidv4).toHaveBeenCalled();
        expect(conv.getId()).toBe('generated-id');
    });

    it('uses provided id', () => {
        const conv = new Conversation('id');
        expect(conv.getId()).toBe('id');
    });

    it('adds messages and retrieves them', () => {
        const conv = new Conversation('c');
        conv.addMessage('user', 'hi', 't1');
        conv.addMessage('assistant', 'hello');

        const msgs = conv.getMessages();
        expect(msgs).toHaveLength(2);
        expect(msgs[1]).toEqual({
            role: 'assistant',
            content: 'hello',
            timestamp: '2020-01-01T00:00:00.000Z'
        });
        expect(conv.getLastMessage()).toEqual(msgs[1]);
    });

    it('creates conversation from Jsonl data - new format', () => {
        const data: JsonlLogEntry[] = [
            { type: 'request', role: 'user', content: 'a', timestamp: 't1' },
            { type: 'response', role: 'assistant', content: 'b', timestamp: 't2' }
        ];
        const conv = Conversation.fromJsonlData(data);
        expect(conv.getMessages()).toEqual([
            { role: 'user', content: 'a', timestamp: 't1' },
            { role: 'assistant', content: 'b', timestamp: 't2' }
        ]);
    });

    it('creates conversation from Jsonl data - legacy format', () => {
        const data: JsonlLogEntry[] = [
            { type: 'request', prompt: 'q', timestamp: 't1' },
            { type: 'response', response: 'r', timestamp: 't2' }
        ];
        const conv = Conversation.fromJsonlData(data);
        expect(conv.getMessages()).toEqual([
            { role: 'user', content: 'q', timestamp: 't1' },
            { role: 'assistant', content: 'r', timestamp: 't2' }
        ]);
    });

    it('skips invalid entries and warns', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const data: JsonlLogEntry[] = [
            { type: 'response', role: 'other' as any, content: 'x', timestamp: 't1' },
            { type: 'error', error: 'bad', timestamp: 't2' },
            { type: 'response', timestamp: 't3' }
        ];
        const conv = Conversation.fromJsonlData(data);
        expect(conv.getMessages()).toEqual([]);
        expect(warnSpy).toHaveBeenCalledTimes(3);
    });
});