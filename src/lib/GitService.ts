// src/lib/GitService.ts
import chalk from 'chalk';
import path from 'path'; // Import path
import ignore, { Ignore } from 'ignore'; // Import ignore
import { CommandService } from './CommandService';
import { FileSystem } from './FileSystem'; // <-- Import FileSystem
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

export class GitService {
    private commandService: CommandService;
    private fs: FileSystem; // <-- Add FileSystem instance variable

    // Inject CommandService AND FileSystem via the constructor
    constructor(commandService: CommandService, fileSystem: FileSystem) { // <-- Add fs parameter
        this.commandService = commandService;
        this.fs = fileSystem; // <-- Assign injected FileSystem
    }

    // --- isGitRepository, initializeRepository (remain unchanged) ---
    async isGitRepository(projectRoot: string): Promise<boolean> {
        console.log(chalk.dim("  Checking if project is a Git repository..."));
        const checkCommand = 'git rev-parse --is-inside-work-tree';
        try {
            const { stdout } = await this.commandService.run(checkCommand, { cwd: projectRoot });
            const isRepo = stdout.trim() === 'true';
            console.log(chalk.dim(`  Is Git repository? ${isRepo}`));
            return isRepo;
        } catch (error: any) {
            const isNotRepoError = error.stderr?.includes('not a git repository');
            const isGitNotFound = error.code === 'ENOENT' || error.message?.includes('command not found');

            if (isGitNotFound) {
                 const gitNotFoundMsg = `Git command not found ('${checkCommand}' failed). Please ensure Git is installed and in your system PATH.`;
                 console.error(chalk.red(`\nError checking Git repository status:`), gitNotFoundMsg);
                 throw new Error(gitNotFoundMsg);
            } else if (isNotRepoError) {
                console.log(chalk.dim("  Is Git repository? false (Not a git repository error detected)"));
                return false;
            } else {
                let genericFailMsg = `Failed to verify Git repository status using '${checkCommand}'. Error: ${error.message || 'Unknown error'}`;
                 if (error.code && error.code !== 0) {
                     genericFailMsg += ` Exit Code: ${error.code}. Stderr: ${error.stderr?.trim() || 'N/A'}`;
                 }
                console.error(chalk.red(`\nError during Git check ('${checkCommand}'):`), genericFailMsg);
                throw new Error(genericFailMsg);
            }
        }
    }

    async initializeRepository(projectRoot: string): Promise<void> {
        console.log(chalk.yellow("  Attempting to initialize Git repository..."));
        const initCommand = 'git init';
        try {
            await this.commandService.run(initCommand, { cwd: projectRoot });
            console.log(chalk.green("  Successfully initialized Git repository."));
        } catch (initError: any) {
            console.error(chalk.red(`\nError during 'git init':`), initError.message || initError);
            let initFailMsg = `Failed to initialize Git repository. Error: ${initError.message || 'Unknown error'}`;
            if (initError.code === 'ENOENT' || initError.message?.includes('command not found')) {
                initFailMsg = `Failed to initialize Git: Git command not found ('${initCommand}' failed). Please ensure Git is installed and in your system PATH.`;
            } else if (initError.stderr) {
                initFailMsg += ` Stderr: ${initError.stderr.trim()}`;
            } else if (initError.code) {
                initFailMsg += ` Exit Code: ${initError.code}`;
            }
            throw new Error(initFailMsg);
        }
    }

    // --- ensureGitRepository (remains deprecated/unchanged) ---
    async ensureGitRepository(projectRoot: string): Promise<void> {
        console.warn(chalk.grey("Warning: ensureGitRepository called. Use isGitRepository and initializeRepository directly for better control."));
        await this.isGitRepository(projectRoot);
    }

    // --- checkCleanStatus (remains unchanged) ---
    async checkCleanStatus(projectRoot: string): Promise<void> {
        console.log(chalk.blue("  Checking Git working directory status..."));
        const statusCommand = 'git status --porcelain';
        try {
            const { stdout, stderr } = await this.commandService.run(statusCommand, { cwd: projectRoot });

            const status = stdout.trim();
            if (status !== '') {
                console.error(chalk.red("\nError: Git working directory not clean:"));
                console.error(chalk.red(status));
                throw new Error('Git working directory not clean. Please commit or stash changes before proceeding.');
            } else {
                 if (stderr.trim()) {
                     console.warn(chalk.yellow(`  Git status check produced unexpected stderr:\n${stderr.trim()}`));
                 }
                console.log(chalk.green("  Git working directory is clean."));
            }
        } catch (error: any) {
            const isGitNotFound = error.code === 'ENOENT' || error.message?.includes('command not found');
             const isNotRepoError = error.stderr?.includes('not a git repository');

            if (isGitNotFound) {
                const gitNotFoundMsg = `Git command not found ('${statusCommand}' failed). Ensure Git is installed and PATH is correct.`;
                console.error(chalk.red(`\nError during '${statusCommand}':`), gitNotFoundMsg);
                throw new Error(gitNotFoundMsg);
            } else if (isNotRepoError) {
                 const notRepoMsg = `Cannot check status: Directory '${projectRoot}' is not a Git repository. This check should only run on existing repos.`;
                 console.error(chalk.red(`\nLogic Error during '${statusCommand}':`), notRepoMsg);
                 throw new Error(notRepoMsg);
            } else {
                 let genericFailMsg = `Failed to verify Git status using '${statusCommand}'. Error: ${error.message || 'Unknown error'}`;
                 if (error.code && error.code !== 0) {
                     genericFailMsg += ` Exit Code: ${error.code}. Stderr: ${error.stderr?.trim() || 'N/A'}`;
                 }
                 console.error(chalk.red(`\nError during '${statusCommand}':`), genericFailMsg);
                 throw new Error(genericFailMsg);
             }
        }
    }

    /**
     * Returns a list of modified files according to `git status --porcelain`.
     */
    async listModifiedFiles(projectRoot: string): Promise<string[]> {
        const { stdout } = await this.commandService.run('git status --porcelain', { cwd: projectRoot });
        return stdout.split('\n').filter(line => line.trim() !== '').map(line => line.slice(3));
    }

    /**
     * Retrieves the diff of pending changes.
     */
    async getDiff(projectRoot: string): Promise<string> {
        const { stdout } = await this.commandService.run('git diff', { cwd: projectRoot });
        return stdout;
    }

    /** Stages all changes in the repository. */
    async stageAllChanges(projectRoot: string): Promise<void> {
        await this.commandService.run('git add -A', { cwd: projectRoot });
    }

    /** Commits all staged changes with the provided message. */
    async commitAll(projectRoot: string, message: string): Promise<void> {
        await execFile('git', ['commit', '-m', message], { cwd: projectRoot });
    }

    // --- MOVED FROM FileSystem: ensureGitignoreRules ---
    /**
     * Ensures .gitignore exists and contains the rule to ignore '.kai/'.
     * Creates the file with defaults if missing, appends the rule if missing from an existing file.
     * Called *after* user confirmation if needed (when no .git exists).
     * Uses the injected FileSystem service for file operations.
     * @param projectRoot The root directory of the project.
     */
    async ensureGitignoreRules(projectRoot: string): Promise<void> {
        console.log(chalk.dim("  Ensuring .gitignore configuration (via GitService)..."));
        const gitignorePath = path.join(projectRoot, '.gitignore');
        // --- IGNORE ENTIRE .kai directory ---
        const kaiIgnoreLine = '.kai/'; // Ignore the whole directory
        const kaiComment = '# Kai internal files (logs, cache, config) - (auto-added by Kai)';
        const defaultNewGitignoreContent = `# Common Node ignores\nnode_modules/\n.DS_Store\n\n${kaiComment}\n${kaiIgnoreLine}\n`;

        try {
            // Use injected fs instance to read
            let gitignoreContent = await this.fs.readFile(gitignorePath); // Returns null if ENOENT

            if (gitignoreContent === null) {
                // --- .gitignore does NOT exist - CREATE IT ---
                console.log(chalk.yellow(`    .gitignore not found. Creating one with rule '${kaiIgnoreLine}'...`));
                try {
                    // Use injected fs instance to write
                    await this.fs.writeFile(gitignorePath, defaultNewGitignoreContent);
                    console.log(chalk.green(`    Successfully created .gitignore.`));
                } catch (writeError) {
                    console.error(chalk.red(`    Error creating .gitignore file at ${gitignorePath}:`), writeError);
                }
            } else {
                // --- .gitignore DOES exist - CHECK & APPEND if needed ---
                console.log(chalk.dim(`    Found existing .gitignore file. Checking for rule...`));
                const lines = gitignoreContent.split('\n').map(line => line.trim());
                const ruleExists = lines.includes(kaiIgnoreLine);

                if (!ruleExists) {
                    console.log(chalk.yellow(`    Rule '${kaiIgnoreLine}' not found in .gitignore. Appending it...`));
                    try {
                        const contentToAppend = (gitignoreContent.endsWith('\n') ? '' : '\n')
                                                + `\n${kaiComment}\n${kaiIgnoreLine}\n`;
                        // Use injected fs instance to append (requires re-reading and writing)
                        const currentContent = await this.fs.readFile(gitignorePath) || ''; // Read again to be safe
                        await this.fs.writeFile(gitignorePath, currentContent + contentToAppend);

                        console.log(chalk.green(`    Successfully appended '${kaiIgnoreLine}' to .gitignore.`));
                    } catch (appendError) {
                        console.error(chalk.red(`    Error appending '${kaiIgnoreLine}' to .gitignore at ${gitignorePath}:`), appendError);
                    }
                } else {
                    console.log(chalk.dim(`    Rule '${kaiIgnoreLine}' already present.`));
                }
            }
        } catch (readError) {
            // Catch errors from readFile *other* than ENOENT
            console.error(chalk.red(`    Error processing .gitignore file at ${gitignorePath}:`), readError);
        }
        console.log(chalk.dim("  .gitignore configuration ensure complete."));
    }

    // --- MOVED FROM FileSystem: readGitignoreForContext (renamed slightly) ---
    /**
     * Reads ignore rules from .gitignore and .kaiignore for in-memory filtering during context building.
     * Does NOT create or modify the files. Always includes default in-memory ignores.
     * Uses the injected FileSystem service to read the files.
     * @param projectRoot The root directory of the project.
     * @returns An `ignore` instance populated with rules from both files and defaults.
     */
    async getIgnoreRules(projectRoot: string): Promise<Ignore> { // Renamed
        const ig = ignore();
        const gitignorePath = path.resolve(projectRoot, '.gitignore'); // Use resolve for consistency
        const kaiignorePath = path.resolve(projectRoot, '.kaiignore'); // Path to .kaiignore at root
        const defaultInMemoryIgnores = ['.git', '.kai/']; // Essential ignores regardless of files

        // --- Step 1: Always add essential *in-memory* ignores ---
        // node_modules and .gitignore should typically be handled by the .gitignore file itself
        ig.add(defaultInMemoryIgnores);

        // --- Step 2: Read the actual .gitignore IF it exists using injected fs ---
        try {
            // Use injected fs instance
            const gitignoreContent = await this.fs.readFile(gitignorePath); // Returns null if ENOENT
            if (gitignoreContent !== null) {
                console.log(chalk.dim(`  Applying rules from existing .gitignore for context building.`));
                ig.add(gitignoreContent);
            } else {
                 console.log(chalk.dim(`  No .gitignore file found, using default ignores for context building.`));
            }
        } catch (readError) {
            // Catch errors from readFile *other* than ENOENT
            console.error(chalk.red(`  Warning: Error reading .gitignore file at ${gitignorePath} for context building:`), readError);
        }

        // --- Step 2b: Read .kaiignore IF it exists using injected fs ---
        try {
             // Use injected fs instance
            const kaiignoreContent = await this.fs.readFile(kaiignorePath); // Returns null if ENOENT
            if (kaiignoreContent !== null) {
                console.log(chalk.dim(`  Applying rules from existing .kaiignore for context building.`));
                ig.add(kaiignoreContent); // Add rules from .kaiignore
            } else {
                 console.log(chalk.dim(`  No .kaiignore file found, skipping additional rules.`));
            }
        } catch (readError) {
            // Catch errors from readFile *other* than ENOENT
             console.error(chalk.red(`  Warning: Error reading .kaiignore file at ${kaiignorePath} for context building:`), readError);
        }
        // --- Step 3: Return the in-memory ignore object ---
        return ig;
    }

    // --- createAnnotatedTag (remains unchanged) ---
    async createAnnotatedTag(projectRoot: string, tagName: string, message: string): Promise<void> {
        if (!tagName || tagName.includes(' ')) {
            throw new Error(`Invalid tag name provided: "${tagName}"`);
        }
        const escapedMessage = message.replace(/"/g, '\\"');
        const tagCommand = `git tag -a "${tagName}" -m "${escapedMessage}"`;

        console.log(chalk.blue(`  Attempting to create Git tag: ${tagName}...`));

        try {
            await this.commandService.run(tagCommand, { cwd: projectRoot });
            console.log(chalk.green(`  Successfully created Git tag: ${tagName}`));
        } catch (tagError: any) {
            console.error(chalk.red(`\nError creating Git tag '${tagName}':`), tagError.message || tagError);
            let tagFailMsg = `Failed to create Git tag '${tagName}'. Error: ${tagError.message || 'Unknown error'}`;
            if (tagError.code === 'ENOENT') {
                tagFailMsg = `Failed to create tag: Git command not found ('${tagCommand}' failed). Ensure Git is installed.`;
            } else if (tagError.stderr) {
                if (tagError.stderr.includes('already exists')) {
                    tagFailMsg = `Failed to create Git tag: Tag '${tagName}' already exists.`;
                     throw new Error(tagFailMsg);
                } else {
                    tagFailMsg += ` Stderr: ${tagError.stderr.trim()}`;
                }
            } else if (tagError.code) {
                tagFailMsg += ` Exit Code: ${tagError.code}`;
            }
            throw new Error(tagFailMsg);
        }
    }
}