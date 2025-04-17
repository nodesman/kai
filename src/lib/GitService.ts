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
     * Ensures the project directory is a Git repository.
     * Attempts to initialize one if it doesn't exist.
     * Should be called once during application startup.
     * @param projectRoot The absolute path to the project root directory.
     * @throws {Error} If Git is not found or initialization fails.
     */
    async ensureGitRepository(projectRoot: string): Promise<void> {
        console.log(chalk.dim("Checking if project is a Git repository..."));
        // Use 'rev-parse' as it's a more direct way to check if inside a repo
        const checkCommand = 'git rev-parse --is-inside-work-tree';
        try {
            await this.commandService.run(checkCommand, { cwd: projectRoot });
            console.log(chalk.dim("  ✓ Git repository found."));
        } catch (error: any) {
            const isNotRepoError = error.stderr?.includes('not a git repository') || error.stdout?.includes('false'); // Check stdout too
            const isGitNotFound = error.code === 'ENOENT' || error.message?.includes('command not found');

            if (isGitNotFound) {
                 const gitNotFoundMsg = `Git command not found ('${checkCommand}' failed). Please ensure Git is installed and in your system PATH.`;
                 console.error(chalk.red(`\nError checking Git repository status:`), gitNotFoundMsg);
                 throw new Error(gitNotFoundMsg);
            } else if (isNotRepoError) {
                // --- Attempt to initialize Git repository ---
                console.log(chalk.yellow("  Project directory is not a Git repository. Attempting to initialize..."));
                const initCommand = 'git init';
                try {
                    await this.commandService.run(initCommand, { cwd: projectRoot });
                    console.log(chalk.green("  Successfully initialized Git repository."));
                    // A newly initialized repo is considered clean for subsequent checks if needed immediately.
                } catch (initError: any) {
                    console.error(chalk.red(`\nError during automatic 'git init':`), initError.message || initError);
                    let initFailMsg = `Failed to automatically initialize Git repository. Error: ${initError.message || 'Unknown error'}`;
                    if (initError.code === 'ENOENT' || initError.message?.includes('command not found')) {
                        initFailMsg = `Failed to initialize Git: Git command not found ('${initCommand}' failed). Please ensure Git is installed and in your system PATH.`;
                    } else if (initError.stderr) {
                        initFailMsg += ` Stderr: ${initError.stderr.trim()}`;
                    } else if (initError.code) {
                        initFailMsg += ` Exit Code: ${initError.code}`;
                    }
                    throw new Error(initFailMsg); // Throw specific error for init failure
                }
                // --- End Git initialization attempt ---
            } else {
                // Handle other unexpected errors from the check command
                let genericFailMsg = `Failed to verify Git repository status using '${checkCommand}'. Error: ${error.message || 'Unknown error'}`;
                 if (error.code && error.code !== 0) {
                     genericFailMsg += ` Exit Code: ${error.code}. Stderr: ${error.stderr?.trim() || 'N/A'}`;
                 }
                console.error(chalk.red(`\nError during Git check ('${checkCommand}'):`), genericFailMsg);
                throw new Error(genericFailMsg);
            }
        }
    }


    /**
     * Checks if the Git working directory is clean (no uncommitted changes).
     * Assumes the directory IS a Git repository (ensureGitRepository should be called first).
     * Used primarily before operations like consolidation.
     * @param projectRoot The absolute path to the project root directory.
     * @throws {Error} If the working directory is not clean or the Git command fails.
     */
    async checkCleanStatus(projectRoot: string): Promise<void> {
        console.log(chalk.blue("  Checking Git working directory status...")); // Renamed log slightly
        const statusCommand = 'git status --porcelain';
        try {
            const { stdout, stderr } = await this.commandService.run(statusCommand, { cwd: projectRoot });

            // Check for uncommitted changes
            const status = stdout.trim();
            if (status !== '') {
                console.error(chalk.red("\nError: Git working directory not clean:"));
                console.error(chalk.red(status)); // Show the specific changes
                throw new Error('Git working directory not clean. Please commit or stash changes before proceeding.');
            } else {
                 // Log stderr only if it contains something unexpected (git status --porcelain shouldn't normally output to stderr on success)
                 if (stderr.trim()) {
                     console.warn(chalk.yellow(`  Git status check produced unexpected stderr:\n${stderr.trim()}`));
                 }
                console.log(chalk.green("  Git working directory is clean."));
            }
        } catch (error: any) {
             // Handle errors from 'git status' command - it should NOT be 'not a repo' here.
            const isGitNotFound = error.code === 'ENOENT' || error.message?.includes('command not found');

            if (isGitNotFound) {
                const gitNotFoundMsg = `Git command not found ('${statusCommand}' failed). Please ensure Git is installed and in your system PATH.`;
                console.error(chalk.red(`\nError during '${statusCommand}':`), gitNotFoundMsg);
                throw new Error(gitNotFoundMsg);
            } else {
                 // Handle other unexpected errors from 'git status'
                let genericFailMsg = `Failed to verify Git status using '${statusCommand}'. Error: ${error.message || 'Unknown error'}`;
                 if (error.code && error.code !== 0) {
                     genericFailMsg += ` Exit Code: ${error.code}. Stderr: ${error.stderr?.trim() || 'N/A'}`;
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