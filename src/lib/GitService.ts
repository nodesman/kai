// src/lib/GitService.ts
import chalk from 'chalk';
import { CommandService } from './CommandService'; // Import the new service

export class GitService {
    private commandService: CommandService; // Instance variable for the service

    // Inject CommandService via the constructor
    constructor(commandService: CommandService) {
        this.commandService = commandService;
    }

    /**
     * Checks if the Git working directory is clean (no uncommitted changes).
     * Attempts to initialize a Git repository if one doesn't exist.
     * Throws an error if the directory is dirty, Git is not found, or initialization fails.
     * @param projectRoot The absolute path to the project root directory.
     * @throws {Error} If the working directory is not clean or Git checks/initialization fail.
     */
    async checkCleanStatus(projectRoot: string): Promise<void> {
        console.log(chalk.blue("  Checking Git status..."));
        const statusCommand = 'git status --porcelain';
        try {
            // Use the CommandService to run the git command
            const { stdout } = await this.commandService.run(statusCommand, { cwd: projectRoot });

            // Check for uncommitted changes
            const status = stdout.trim();
            if (status !== '') {
                console.error(chalk.red("\nError: Git working directory not clean:"));
                console.error(chalk.red(status)); // Show the specific changes
                throw new Error('Git working directory not clean. Consolidation aborted. Please commit or stash changes before consolidating.');
            } else {
                console.log(chalk.green("  Git status clean."));
            }
        } catch (error: any) {
            // Handle errors from 'git status' command
            const isNotRepoError = error.stderr?.includes('not a git repository');
            const isGitNotFound = error.code === 'ENOENT' || error.message?.includes('command not found');

            if (isNotRepoError) {
                // --- Attempt to initialize Git repository ---
                console.log(chalk.yellow("  Warning: Project directory is not a Git repository. Attempting to initialize..."));
                try {
                    const initCommand = 'git init';
                    // Use CommandService to run 'git init'
                    await this.commandService.run(initCommand, { cwd: projectRoot });
                    console.log(chalk.green("  Successfully initialized Git repository."));
                    // A newly initialized repo is considered clean, so we can return successfully.
                    return;
                } catch (initError: any) {
                    // Handle errors during 'git init'
                    console.error(chalk.red(`\nError during automatic '${initCommand}':`), initError.message || initError);
                    let initFailMsg = `Failed to automatically initialize Git repository. Error: ${initError.message || 'Unknown error'}`;
                    if (initError.code === 'ENOENT' || initError.message?.includes('command not found')) {
                        initFailMsg = 'Failed to initialize Git: Git command not found. Please ensure Git is installed and in your system PATH.';
                    } else if (initError.stderr) {
                        initFailMsg += ` Stderr: ${initError.stderr.trim()}`;
                    } else if (initError.code) {
                         initFailMsg += ` Exit Code: ${initError.code}`;
                    }
                    throw new Error(initFailMsg); // Throw specific error for init failure
                }
                // --- End Git initialization attempt ---
            } else if (isGitNotFound) {
                const gitNotFoundMsg = 'Git command not found. Please ensure Git is installed and in your system PATH.';
                console.error(chalk.red(`\nError during '${statusCommand}':`), gitNotFoundMsg);
                throw new Error(gitNotFoundMsg);
            } else if (error.message?.includes('Git working directory not clean')) {
                // Re-throw the specific "not clean" error caught earlier
                console.error(chalk.red(`\nError during '${statusCommand}':`), error.message);
                throw error;
            } else {
                // Handle other unexpected errors from 'git status'
                let genericFailMsg = `Failed to verify Git status. Error: ${error.message || 'Unknown error'}`;
                if (error.code && error.code !== 0) {
                    genericFailMsg = `Git command '${statusCommand}' failed with exit code ${error.code}. Stderr: ${error.stderr?.trim() || 'N/A'}`;
                }
                console.error(chalk.red(`\nError during '${statusCommand}':`), genericFailMsg);
                throw new Error(genericFailMsg);
            }
        }
    }

    // --- Potential future methods (would also use this.commandService.run) ---
    // async stageFile(projectRoot: string, filePath: string): Promise<void> {
    //     await this.commandService.run(`git add ${filePath}`, { cwd: projectRoot });
    // }
    // async commitChanges(projectRoot: string, message: string): Promise<void> {
    //     await this.commandService.run(`git commit -m "${message}"`, { cwd: projectRoot });
    // }
    // async getCurrentBranch(projectRoot: string): Promise<string> {
    //     const { stdout } = await this.commandService.run('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot });
    //     return stdout.trim();
    // }
    // --- End potential future methods ---
}