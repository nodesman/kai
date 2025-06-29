import { TypeScriptLoop } from '../feedback/TypeScriptLoop';

describe('TypeScriptLoop', () => {
    it('runs tsc when tsconfig exists', async () => {
        const fs = { access: jest.fn().mockResolvedValue(undefined) } as any;
        const commandService = { run: jest.fn().mockResolvedValue({ stdout: 'ok', stderr: '' }) } as any;
        const config = { project: { typescript_autofix: false } } as any;
        const loop = new TypeScriptLoop(commandService, fs, config);
        const res = await loop.run('/project');
        expect(commandService.run).toHaveBeenCalledWith('npx tsc --noEmit', { cwd: '/project' });
        expect(res.success).toBe(true);
    });

    it('returns failure when compilation fails', async () => {
        const fs = { access: jest.fn().mockResolvedValue(undefined) } as any;
        const commandService = { run: jest.fn().mockRejectedValue({ stderr: 'err' }) } as any;
        const config = { project: { typescript_autofix: true } } as any;
        const loop = new TypeScriptLoop(commandService, fs, config);
        const res = await loop.run('/project');
        expect(res.success).toBe(false);
        expect(res.log).toContain('err');
    });

    it('skips when tsconfig is missing and autofix disabled', async () => {
        const fs = { access: jest.fn().mockRejectedValue(new Error('missing')) } as any;
        const commandService = { run: jest.fn() } as any;
        const config = { project: { typescript_autofix: false } } as any;
        const loop = new TypeScriptLoop(commandService, fs, config);
        const res = await loop.run('/project');
        expect(commandService.run).not.toHaveBeenCalled();
        expect(res).toEqual({ success: true, log: '' });
    });

    it('runs tsc when tsconfig missing but autofix enabled', async () => {
        const fs = { access: jest.fn().mockRejectedValue(new Error('missing')) } as any;
        const commandService = { run: jest.fn().mockResolvedValue({ stdout: ' ok ', stderr: ' warn ' }) } as any;
        const config = { project: { typescript_autofix: true } } as any;
        const loop = new TypeScriptLoop(commandService, fs, config);
        const res = await loop.run('/project');
        expect(commandService.run).toHaveBeenCalledWith('npx tsc --noEmit', { cwd: '/project' });
        expect(res).toEqual({ success: true, log: 'ok\nwarn' });
    });

    it('handles error with stdout and message fields', async () => {
        const fs = { access: jest.fn().mockResolvedValue(undefined) } as any;
        const err: any = new Error('boom');
        err.stdout = ' out ';
        const commandService = { run: jest.fn().mockRejectedValue(err) } as any;
        const config = { project: { typescript_autofix: true } } as any;
        const loop = new TypeScriptLoop(commandService, fs, config);
        const res = await loop.run('/project');
        expect(res).toEqual({ success: false, log: 'out\nboom' });
    });

    it('handles error without stderr or message', async () => {
        const fs = { access: jest.fn().mockResolvedValue(undefined) } as any;
        const err: any = new Error('');
        err.message = '';
        const commandService = { run: jest.fn().mockRejectedValue(err) } as any;
        const config = { project: { typescript_autofix: true } } as any;
        const loop = new TypeScriptLoop(commandService, fs, config);
        const res = await loop.run('/project');
        expect(res).toEqual({ success: false, log: '' });
    });
});
