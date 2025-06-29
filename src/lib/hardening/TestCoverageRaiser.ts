import path from 'path';
import chalk from 'chalk';
import { Config } from '../Config';
import { FileSystem, logDiffFailure } from '../FileSystem';
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

        const summaryPath = path.join(this.projectRoot, 'coverage', 'coverage-summary.json');
        await this._runJestCoverage();
        let summary = await this._readCoverageSummary(summaryPath);
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
        const testPath = this._deriveTestPath(targetFile);
        let testContent = await this.fs.readFile(testPath);

        if (testContent === null) {
            const stub = `describe('${path.basename(targetFile, path.extname(targetFile))}', () => {});`;
            await this.fs.writeFile(testPath, stub);
            testContent = stub;
        }

        for (let i = 0; i < (this.config.project.coverage_iterations ?? 1); i++) {
            let coverageInfoEntry = summary[targetFile];
            if (!coverageInfoEntry) {
                const rel = path.relative(this.projectRoot, targetFile);
                coverageInfoEntry = summary[rel];
            }
            const coverageInfo = JSON.stringify(coverageInfoEntry || {});

            testContent = (await this.fs.readFile(testPath)) ?? '';
            const prompt = TestCoveragePrompts.generateTestDiff(testPath, testContent, coverageInfo);
            const diff = await this.aiClient.getResponseTextFromAI([
                { role: 'user', content: prompt }
            ], false);

            const applied = await this.fs.applyDiffToFile(testPath, diff);
            if (!applied) {
                const info = this.fs.lastDiffFailure || { file: testPath, diff, fileContent: testContent };
                await logDiffFailure(this.fs, info.file, info.diff, info.fileContent, info.error);
                break;
            }

            await this._runJestCoverage();
            summary = await this._readCoverageSummary(summaryPath);
            if (!summary) break;
            coverageInfoEntry = summary[targetFile] || summary[path.relative(this.projectRoot, targetFile)];
            if (coverageInfoEntry?.lines?.pct === 100) {
                break;
            }
        }
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

        if (!lowest) {
            return null;
        }

        let rawFilePathFromSummary = lowest.path;
        const absoluteProjectRoot = path.resolve(this.projectRoot); // Ensure projectRoot is absolute and normalized

        // Case 1: The path from summary is already a correctly formed absolute path.
        if (path.isAbsolute(rawFilePathFromSummary) && rawFilePathFromSummary.startsWith(absoluteProjectRoot)) {
            return path.normalize(rawFilePathFromSummary);
        }

        // Case 2: The problematic scenario - a relative path that starts with the
        // components of the absolute project root (e.g., 'Users/rajsekharan/projects/kai/src/file.ts').
        // We need to strip this leading redundant part before joining.

        // Get the relative path string of the project root itself.
        // For `/Users/rajsekharan/projects/kai`, this yields `Users/rajsekharan/projects/kai`.
        const relativeProjectRootString = path.relative(path.parse(absoluteProjectRoot).root, absoluteProjectRoot);

        if (!path.isAbsolute(rawFilePathFromSummary) && rawFilePathFromSummary.startsWith(relativeProjectRootString)) {
            // Strip the problematic prefix.
            const strippedPath = rawFilePathFromSummary.substring(relativeProjectRootString.length);
            // Ensure a leading path separator if necessary (e.g., for 'src/file.ts' after stripping).
            const finalRelativePart = path.normalize(
                strippedPath.startsWith(path.sep) || strippedPath === '' ? strippedPath : path.sep + strippedPath
            );
            // Now, join the absolute project root with the correctly relative part.
            return path.join(absoluteProjectRoot, finalRelativePart);
        }

        // Case 3: It's a standard relative path (e.g., 'src/file.ts') relative to the project root.
        // Or an absolute path that didn't start with the project root (less likely for internal files).
        // `path.resolve` will correctly handle these by joining with the project root.
        return path.resolve(absoluteProjectRoot, rawFilePathFromSummary);
    }
}