import { Config } from '../Config';
import { TestRunnerService } from './TestRunnerService';

export interface TestGenerator {
    generateTests(summary: any): Promise<void>;
}

export class CoverageService {
    private config: Config;
    private runner: TestRunnerService;
    private generator: TestGenerator;

    constructor(config: Config, runner: TestRunnerService, generator: TestGenerator) {
        this.config = config;
        this.runner = runner;
        this.generator = generator;
    }

    private hasUncovered(summary: any): boolean {
        return summary.total && summary.total.lines && summary.total.lines.pct < 100;
    }

    async improveCoverage(projectRoot: string): Promise<any> {
        const maxIter = this.config.project.coverage_iterations ?? 3;
        let iter = 0;
        let summary = await this.runner.runCoverage(projectRoot);
        while (this.hasUncovered(summary) && iter < maxIter) {
            await this.generator.generateTests(summary);
            summary = await this.runner.runCoverage(projectRoot);
            iter++;
        }
        return summary;
    }
}
