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
});
