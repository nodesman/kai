import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { GitService } from './GitService';
import { DEFAULT_CONFIG_YAML } from './config_defaults';

export interface ScaffoldOptions {
    language: string;
    framework: string;
    directoryName: string;
}

export class ProjectScaffolder {
    private fs: FileSystem;
    private git: GitService;

    constructor(fs: FileSystem, git: GitService) {
        this.fs = fs;
        this.git = git;
    }

    async scaffoldProject(options: ScaffoldOptions): Promise<string> {
        const projectPath = path.resolve(process.cwd(), options.directoryName);
        console.log(chalk.cyan(`\nScaffolding project at ${projectPath}...`));
        await this.fs.ensureDirExists(projectPath);

        await this.createBaseFiles(projectPath, options);
        await this.initializeKaiFiles(projectPath);
        await this.git.initializeRepository(projectPath);
        await this.git.ensureGitignoreRules(projectPath);
        console.log(chalk.green('Project scaffold complete.'));
        return projectPath;
    }

    private async createBaseFiles(projectPath: string, opts: ScaffoldOptions): Promise<void> {
        const readme = `# ${opts.directoryName}\n\nGenerated with Kai.`;
        await this.fs.writeFile(path.join(projectPath, 'README.md'), readme);

        if (opts.language === 'TypeScript' && opts.framework === 'Node') {
            const pkg = {
                name: opts.directoryName,
                version: '0.1.0',
                scripts: { build: 'tsc', start: 'node dist/index.js' }
            };
            await this.fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(pkg, null, 2));
            const tsconfig = {
                compilerOptions: {
                    target: 'es2019',
                    module: 'commonjs',
                    outDir: 'dist',
                    strict: true,
                    esModuleInterop: true
                }
            };
            await this.fs.writeFile(path.join(projectPath, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
            await this.fs.ensureDirExists(path.join(projectPath, 'src'));
            await this.fs.writeFile(path.join(projectPath, 'src/index.ts'), 'console.log("Hello from Kai");\n');
        }
    }

    private async initializeKaiFiles(projectPath: string): Promise<void> {
        const kaiDir = path.join(projectPath, '.kai');
        await this.fs.ensureDirExists(path.join(kaiDir, 'logs'));
        const configPath = path.join(kaiDir, 'config.yaml');
        await this.fs.writeFile(configPath, DEFAULT_CONFIG_YAML);
        await this.fs.writeFile(path.join(projectPath, '.kaiignore'), '# Add patterns to ignore in Kai context\n');
    }
}
