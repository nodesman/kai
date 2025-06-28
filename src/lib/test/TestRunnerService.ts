import path from 'path';
import { CommandService } from '../CommandService';
import { FileSystem } from '../FileSystem';

/**
 * Runs Jest with coverage and returns the parsed coverage summary.
 */
export class TestRunnerService {
    private command: CommandService;
    private fs: FileSystem;

    constructor(command: CommandService, fs: FileSystem) {
        this.command = command;
        this.fs = fs;
    }

    async runCoverage(projectRoot: string): Promise<any> {
        await this.command.run('npx jest --coverage --coverageReporters=json-summary', { cwd: projectRoot });
        const summaryPath = path.join(projectRoot, 'coverage', 'coverage-summary.json');
        const content = await this.fs.readFile(summaryPath);
        if (!content) throw new Error('Coverage summary not found');
        return JSON.parse(content);
    }
}
