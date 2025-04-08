// src/lib/GitService.ts
import { ShellExecutor } from './ShellExecutor';
import chalk from 'chalk';

interface GitStatusError extends Error {
    isGitError?: boolean; // Flag to identify Git-specific errors vs execution errors
    reason?: 'NOT_A_REPO' | 'UNABLE_TO_ACCESS' | 'OTHER';
}

export class GitService {
    private shellExecutor: ShellExecutor;
    private projectRoot: string;

    constructor(shellExecutor: ShellExecutor, projectRoot: string) {
        this.shellExecutor = shellExecutor;
        this.projectRoot = projectRoot;
    }

    /**
     * Checks if the Git working directory is clean (no uncommitted changes).
     * @returns Promise resolving to true if clean, false otherwise.
     * @throws GitStatusError if Git command fails (e.g., not a repo, git not installed).
     */
    async isWorkingDirectoryClean(): Promise<boolean> {
        console.log(chalk.dim('Checking Git working directory status...'));
        try {
            const { stdout, stderr } = await this.shellExecutor.execute('git status --porcelain', { cwd: this.projectRoot });

            // If stderr has content, it might indicate a problem *before* the status check itself
            // (e.g., "not a git repository"). The execute method should throw for non-zero exit,
            // but let's double-check stderr for known Git issues.
            if (stderr && stderr.toLowerCase().includes('not a git repository')) {
                const error = new Error(`Project directory is not a Git repository: ${this.projectRoot}`) as GitStatusError;
                error.isGitError = true;
                error.reason = 'NOT_A_REPO';
                throw error;
            }
             if (stderr && stderr.toLowerCase().includes('unable to access')) {
                const error = new Error(`Unable to access Git repository files: ${stderr}`) as GitStatusError;
                error.isGitError = true;
                error.reason = 'UNABLE_TO_ACCESS';
                throw error;
            }
             if (stderr) {
                 // Log unexpected stderr content but proceed to check stdout if exit code was 0
                 console.warn(chalk.yellow(`Git status stderr (unexpected but continuing): ${stderr}`));
             }


            // If stdout is empty, the working directory is clean.
            const isClean = stdout === '';
            console.log(chalk.dim(`Git working directory is ${isClean ? 'clean' : 'dirty'}.`));
            return isClean;

        } catch (error: any) {
            // Handle errors specifically from the shell execution (e.g., command not found)
            // or errors already identified above.
            if ((error as GitStatusError).isGitError) {
                // Re-throw errors already classified by us
                throw error;
            }

            // Assume other errors are related to executing git itself
            const gitError = new Error(`Failed to execute 'git status'. Error: ${error.message}`) as GitStatusError;
            gitError.isGitError = true;
            gitError.reason = 'OTHER';

            if (error.message?.includes('command not found') || error.code === 'ENOENT') {
                 gitError.message = 'Git command not found. Please ensure Git is installed and in your system PATH.';
            } else if (error.stderr?.toLowerCase().includes('not a git repository')) {
                 gitError.message = `Project directory is not a Git repository: ${this.projectRoot}`;
                 gitError.reason = 'NOT_A_REPO';
            } else if (error.stderr?.toLowerCase().includes('unable to access')) {
                 gitError.message = `Unable to access Git repository files: ${error.stderr}`;
                 gitError.reason = 'UNABLE_TO_ACCESS';
            }
             // Include stderr if available and not already in the message
             else if (error.stderr && !gitError.message.includes(error.stderr)) {
                gitError.message += ` Stderr: ${error.stderr}`;
            }

            console.error(chalk.red(`Git status check failed: ${gitError.message}`));
            throw gitError;
        }
    }

    // --- Placeholder for future Git operations ---
    // async stageFiles(files: string[]): Promise<void> { ... }
    // async commitChanges(message: string): Promise<void> { ... }
    // ---
}

// Export the error type if needed elsewhere
export type { GitStatusError };