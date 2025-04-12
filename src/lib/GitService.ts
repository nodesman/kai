// src/lib/GitService.ts
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const exec = promisify(execCb);

export class GitService {

    /**
     * Checks if the Git working directory is clean (no uncommitted changes).
     * Throws an error if the directory is dirty, Git is not found, or it's not a Git repository.
     * @param projectRoot The absolute path to the project root directory.
     * @throws {Error} If the working directory is not clean or Git checks fail.
     */
    async checkCleanStatus(projectRoot: string): Promise<void> {
        console.log(chalk.blue("  Checking Git status..."));
        try {
            const { stdout, stderr } = await exec('git status --porcelain', { cwd: projectRoot });

            if (stderr) {
                // Log stderr but don't necessarily fail immediately, as some warnings might go here
                console.warn(chalk.yellow("  Git status stderr:"), stderr.trim());
            }

            const status = stdout.trim();
            if (status !== '') {
                console.error(chalk.red("\nError: Git working directory not clean:"));
                console.error(chalk.red(status));
                throw new Error('Git working directory not clean. Consolidation aborted. Please commit or stash changes before consolidating.');
            } else {
                console.log(chalk.green("  Git status clean."));
            }
        } catch (error: any) {
            // Handle errors during Git check more specifically
            console.error(chalk.red("\nError checking Git status:"), error.message || error);
            let gitCheckErrorMsg = `Failed to verify Git status. Error: ${error.message}`;

            if (error.message?.includes('command not found') || error.code === 'ENOENT') {
                gitCheckErrorMsg = 'Git command not found. Please ensure Git is installed and in your system PATH.';
            } else if (error.stderr?.includes('not a git repository')) {
                // Check stderr specifically for the "not a git repository" message
                gitCheckErrorMsg = 'Project directory is not a Git repository. Please initialize Git (`git init`).';
            } else if (error.message?.includes('Git working directory not clean')) {
                 // Re-throw the specific error message if it was already thrown above
                 gitCheckErrorMsg = error.message;
            }
             // Add more specific checks if needed based on observed errors

            // Throw a new error with the curated message
            throw new Error(gitCheckErrorMsg);
        }
    }

    // --- Potential future methods ---
    // async stageFile(projectRoot: string, filePath: string): Promise<void> { ... }
    // async commitChanges(projectRoot: string, message: string): Promise<void> { ... }
    // async getCurrentBranch(projectRoot: string): Promise<string> { ... }
    // --- End potential future methods ---
}