// src/lib/GitService.ts
// Remove direct imports of execCb and promisify if no longer needed elsewhere
// import { exec as execCb } from 'child_process';
// import { promisify } from 'util';
import chalk from 'chalk';
import { CommandService } from './CommandService'; // Import the new service

// Remove the local exec constant
// const exec = promisify(execCb);

export class GitService {
    private commandService: CommandService; // Instance variable for the service

    // Inject CommandService via the constructor
    constructor(commandService: CommandService) {
        this.commandService = commandService;
    }

    /**
     * Checks if the Git working directory is clean (no uncommitted changes).
     * Throws an error if the directory is dirty, Git is not found, or it's not a Git repository.
     * @param projectRoot The absolute path to the project root directory.
     * @throws {Error} If the working directory is not clean or Git checks fail.
     */
    async checkCleanStatus(projectRoot: string): Promise<void> {
        console.log(chalk.blue("  Checking Git status..."));
        const command = 'git status --porcelain';
        try {
            // Use the CommandService to run the git command
            const { stdout, stderr } = await this.commandService.run(command, { cwd: projectRoot });

            // stderr logging is handled by CommandService, but we can still react to it if needed

            const status = stdout.trim();
            if (status !== '') {
                console.error(chalk.red("\nError: Git working directory not clean:"));
                console.error(chalk.red(status)); // Show the specific changes
                // Throw the specific error message
                throw new Error('Git working directory not clean. Consolidation aborted. Please commit or stash changes before consolidating.');
            } else {
                console.log(chalk.green("  Git status clean."));
            }
        } catch (error: any) {
            // Error handling remains similar, but the error object now comes from CommandService
            // The structure (stdout, stderr, code) should be the same if it's an exec error
            console.error(chalk.red(`\nError during '${command}':`), error.message || error);

            let gitCheckErrorMsg = `Failed to verify Git status. Error: ${error.message || 'Unknown error'}`;

            // Check specific conditions based on the error object properties
            if (error.code === 'ENOENT' || error.message?.includes('command not found')) {
                 gitCheckErrorMsg = 'Git command not found. Please ensure Git is installed and in your system PATH.';
            } else if (error.stderr?.includes('not a git repository')) {
                 gitCheckErrorMsg = 'Project directory is not a Git repository. Please initialize Git (`git init`).';
            } else if (error.message?.includes('Git working directory not clean')) {
                 // Re-use the specific message thrown above if caught here
                 gitCheckErrorMsg = error.message;
            } else if (error.code && error.code !== 0) {
                 // Generic failure based on exit code
                 gitCheckErrorMsg = `Git command failed with exit code ${error.code}. Stderr: ${error.stderr?.trim() || 'N/A'}`;
            }
            // Add more specific checks if needed

            // Throw a new error with the curated message
            throw new Error(gitCheckErrorMsg);
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