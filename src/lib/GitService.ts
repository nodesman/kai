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
     * Checks if the specified directory is a Git repository.
     * @param projectRoot The absolute path to the project root directory.
     * @returns A promise resolving to `true` if it's a Git repo, `false` otherwise.
     * @throws {Error} If the Git command itself fails (e.g., Git not found).
     */
    async isGitRepository(projectRoot: string): Promise<boolean> {
        console.log(chalk.dim("  Checking if project is a Git repository..."));
        const checkCommand = 'git rev-parse --is-inside-work-tree';
        try {
            // Use run and check stdout. If it succeeds and stdout is 'true', it's a repo.
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
                 throw new Error(gitNotFoundMsg); // Critical failure
            } else if (isNotRepoError) {
                // This is expected if it's not a repo, return false.
                console.log(chalk.dim("  Is Git repository? false (Not a git repository error detected)"));
                return false;
            } else {
                // Handle other unexpected errors from the check command
                let genericFailMsg = `Failed to verify Git repository status using '${checkCommand}'. Error: ${error.message || 'Unknown error'}`;
                 if (error.code && error.code !== 0) {
                     genericFailMsg += ` Exit Code: ${error.code}. Stderr: ${error.stderr?.trim() || 'N/A'}`;
                 }
                console.error(chalk.red(`\nError during Git check ('${checkCommand}'):`), genericFailMsg);
                throw new Error(genericFailMsg); // Critical failure
            }
        }
    }

     /**
      * Initializes a Git repository in the specified directory.
      * Should only be called after user confirmation if the directory wasn't already a repo.
      * @param projectRoot The absolute path to the project root directory.
      * @throws {Error} If Git initialization fails.
      */
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
             throw new Error(initFailMsg); // Throw specific error for init failure
         }
     }

    /**
     * Ensures the project directory is a Git repository.
     * *** DEPRECATED in favor of isGitRepository check and explicit initializeRepository call after confirmation. ***
     * This method remains for potential internal use but shouldn't handle auto-init anymore.
     * @param projectRoot The absolute path to the project root directory.
     * @throws {Error} If Git is not found.
     */
    async ensureGitRepository(projectRoot: string): Promise<void> {
        console.warn(chalk.grey("Warning: ensureGitRepository called. Use isGitRepository and initializeRepository directly for better control."));
        await this.isGitRepository(projectRoot); // Just perform the check, relies on isGitRepository throwing if git not found
    }

    /**
     * Checks if the Git working directory is clean (no uncommitted changes).
     * Assumes the directory IS a Git repository (isGitRepository should be true).
     * Used primarily before operations like consolidation.
     * @param projectRoot The absolute path to the project root directory.
     * @throws {Error} If the working directory is not clean or the Git command fails.
     */
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
             // If it's *not* a repo, this check shouldn't have been called - indicates logic error elsewhere.
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
     * Finds the latest SemVer tag matching a given prefix.
     * Tags must be in the format `prefixX.Y.Z`.
     * @param projectRoot The absolute path to the project root directory.
     * @param prefix The prefix to filter tags by (e.g., "kai_consolidate_v").
     * @returns A promise resolving to the latest tag name string (e.g., "kai_consolidate_v1.2.3") or null if no matching SemVer tags are found.
     * @throws {Error} If the Git command fails.
     */
    async getLatestSemverTag(projectRoot: string, prefix: string): Promise<string | null> {
        // Escape the prefix for shell command and ensure it ends with 'v' if not provided correctly
        const sanitizedPrefix = prefix.endsWith('v') ? prefix : prefix + 'v';
        // Command to list tags matching the prefix, sorted by version descendingly
        // Uses --sort=-v:refname which handles SemVer sorting correctly (e.g., 1.10.0 > 1.2.0)
        const listCommand = `git tag --list "${sanitizedPrefix}*" --sort=-v:refname`;

        console.log(chalk.dim(`  Fetching latest SemVer tag with prefix '${sanitizedPrefix}'...`));

        try {
            const { stdout, stderr } = await this.commandService.run(listCommand, { cwd: projectRoot });

            if (stderr.trim()) {
                console.warn(chalk.yellow(`  Git tag list command produced stderr: ${stderr.trim()}`));
            }

            const tags = stdout.trim().split('\n').filter(tag => tag); // Filter out empty lines

            if (tags.length === 0) {
                console.log(chalk.dim(`  No existing tags found with prefix '${sanitizedPrefix}'.`));
                return null;
            }

            // The first tag in the sorted list is the latest SemVer tag
            const latestTag = tags[0];
            console.log(chalk.dim(`  Found latest tag: ${latestTag}`));
            return latestTag;

        } catch (listError: any) {
            console.error(chalk.red(`\nError listing Git tags with prefix '${sanitizedPrefix}':`), listError.message || listError);
            let listFailMsg = `Failed to list Git tags. Error: ${listError.message || 'Unknown error'}`;
            if (listError.code === 'ENOENT') {
                listFailMsg = `Failed to list tags: Git command not found ('${listCommand}' failed). Ensure Git is installed.`;
            } else if (listError.stderr) {
                listFailMsg += ` Stderr: ${listError.stderr.trim()}`;
            } else if (listError.code) {
                listFailMsg += ` Exit Code: ${listError.code}`;
            }
            throw new Error(listFailMsg);
        }
    }


    /**
     * Creates an annotated Git tag.
     * @param projectRoot The absolute path to the project root directory.
     * @param tagName The name for the tag.
     * @param message The annotation message for the tag.
     * @throws {Error} If the Git tag command fails.
     */
    async createAnnotatedTag(projectRoot: string, tagName: string, message: string): Promise<void> {
        // Basic validation for tag name (Git has stricter rules, but this catches obvious issues)
        if (!tagName || tagName.includes(' ')) {
            throw new Error(`Invalid tag name provided: "${tagName}"`);
        }
        // Escape the message for the command line (simple quoting for now)
        const escapedMessage = message.replace(/"/g, '\\"'); // Basic double quote escaping
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
                // Check for common tag errors like "tag already exists"
                if (tagError.stderr.includes('already exists')) {
                    tagFailMsg = `Failed to create Git tag: Tag '${tagName}' already exists.`;
                     console.warn(chalk.yellow(`  Tag '${tagName}' already exists. Skipping creation.`));
                     // Allow it to proceed without throwing for this specific case in auto-tagging.
                     return; // Exit the function gracefully if tag already exists
                } else {
                    tagFailMsg += ` Stderr: ${tagError.stderr.trim()}`;
                }
            } else if (tagError.code) {
                tagFailMsg += ` Exit Code: ${tagError.code}`;
            }
            // Only throw if it wasn't the "already exists" error
            throw new Error(tagFailMsg);
        }
    }
}