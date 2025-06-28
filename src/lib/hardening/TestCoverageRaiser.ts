import path from 'path';
import chalk from 'chalk';
import { Config } from '../Config';
import { FileSystem } from '../FileSystem';
import { CommandService } from '../CommandService';
import { AIClient } from '../AIClient';
import { TestCoveragePrompts } from './TestCoveragePrompts';

export class TestCoverageRaiser {
    private config: Config;
    private fs: FileSystem;
    private commandService: CommandService;
    private aiClient: AIClient;
    private projectRoot: string;

    constructor(
        config: Config,
        fs: FileSystem,
        commandService: CommandService,
        aiClient: AIClient,
        projectRoot: string
    ) {
        this.config = config;
        this.fs = fs;
        this.commandService = commandService;
        this.aiClient = aiClient;
        this.projectRoot = projectRoot;
    }

    updateAIClient(aiClient: AIClient) {
        this.aiClient = aiClient;
    }

    async process(tool: string): Promise<void> {
        if (tool !== 'jest') {
            console.log(chalk.yellow(`Unsupported test framework: ${tool}`));
            return;
        }

        await this._runJestCoverage();
        const summaryPath = path.join(this.projectRoot, 'coverage', 'coverage-summary.json');
        const summary = await this._readCoverageSummary(summaryPath);
        if (!summary) {
            console.log(chalk.red('Coverage summary not found.'));
            return;
        }

        const targetFile = this._findLowestCoverageFile(summary);
        if (!targetFile) {
            console.log(chalk.green('All files fully covered.'));
            return;
        }
        console.log(chalk.cyan(`Generating tests for ${targetFile}...`));
        const fileContent = await this.fs.readFile(targetFile);
        if (!fileContent) {
            console.log(chalk.red(`Unable to read ${targetFile}`));
            return;
        }
        const coverageInfo = JSON.stringify(summary[targetFile] || {});
        const prompt = TestCoveragePrompts.generateTests(targetFile, fileContent, coverageInfo);
        const testContent = await this.aiClient.getResponseTextFromAI([
            { role: 'user', content: prompt }
        ], false);
        const testPath = this._deriveTestPath(targetFile);
        await this.fs.writeFile(testPath, testContent);
        console.log(chalk.green(`Test written to ${testPath}`));
    }

    private _deriveTestPath(file: string): string {
        const dir = path.dirname(file);
        const base = path.basename(file).replace(/\.ts$/, '.test.ts');
        return path.join(dir, base);
    }

    private async _runJestCoverage(): Promise<void> {
        try {
            await this.commandService.run('npx jest --coverage --coverageReporters=json-summary', {
                cwd: this.projectRoot
            });
        } catch (err) {
            console.error(chalk.red('Jest coverage run failed.'), err);
        }
    }

    private async _readCoverageSummary(p: string): Promise<any | null> {
        try {
            const raw = await this.fs.readFile(p);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    private _findLowestCoverageFile(summary: any): string | null {
        let lowest: { path: string; pct: number } | null = null;
        for (const [filePath, info] of Object.entries<any>(summary)) {
            if (filePath === 'total') continue;
            const pct = info.lines?.pct ?? 100;
            if (lowest === null || pct < lowest.pct) {
                lowest = { path: filePath, pct };
            }
        }
        return lowest ? path.join(this.projectRoot, lowest.path) : null;
    }
}
