import path from 'path';
import { FeedbackLoop } from './FeedbackLoop';
import { CommandService } from '../../CommandService';
import { Config } from '../../Config';
import { FileSystem } from '../../FileSystem';

export class TypeScriptLoop implements FeedbackLoop {
    private commandService: CommandService;
    private fs: FileSystem;
    private config: Config;

    constructor(commandService: CommandService, fileSystem: FileSystem, config: Config) {
        this.commandService = commandService;
        this.fs = fileSystem;
        this.config = config;
    }

    async run(projectRoot: string): Promise<{ success: boolean; log: string }> {
        const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
        let tsconfigExists = false;
        try {
            await this.fs.access(tsconfigPath);
            tsconfigExists = true;
        } catch {
            tsconfigExists = false;
        }

        if (!tsconfigExists && !this.config.project.typescript_autofix) {
            return { success: true, log: '' }; // skip when not applicable
        }

        try {
            const { stdout, stderr } = await this.commandService.run('npx tsc --noEmit', { cwd: projectRoot });
            const log = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
            return { success: true, log };
        } catch (err: any) {
            const stdout = err.stdout || '';
            const stderr = err.stderr || err.message || '';
            const log = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
            return { success: false, log };
        }
    }
}
