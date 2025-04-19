// File: src/lib/FileSystem.ts
import fs from 'fs/promises'; // Ensure using promises
import path from 'path';
import ignore, { Ignore } from 'ignore'; // Import Ignore type as well
import chalk from 'chalk'; // Import chalk for logging

// Define items typically ignored when checking for "emptiness"
const SAFE_TO_IGNORE_FOR_EMPTY_CHECK = new Set([
    '.DS_Store',    // macOS specific
    'Thumbs.db',    // Windows specific
    '.git',         // Git directory
    '.gitignore',   // Git ignore file
    '.gitattributes',// Git attributes file
    '.kai',         // Kai configuration/log directory
    // Add other common OS/editor config files if needed
    '.vscode',
    '.idea',
]);

class FileSystem {

    // --- Common FS methods (remain unchanged) ---
    async access(filePath: string): Promise<void> {
        await fs.access(filePath);
    }

    async deleteFile(filePath: string): Promise<void> {
        await fs.unlink(filePath);
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        const dir = path.dirname(filePath);
        await this.ensureDirExists(dir);
        await fs.writeFile(filePath, content, 'utf-8');
    }

    async readFile(filePath: string): Promise<string | null> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null; // Return null if file doesn't exist
            }
            console.error(chalk.red(`Error reading file ${filePath}:`), error);
            throw error; // Rethrow other errors
        }
    }
    // --- End common FS methods ---

    /**
     * Checks if a directory is empty or contains only commonly ignored files/dirs
     * (like .git, .kai, .DS_Store). Used to gauge if initializing Kai is safe.
     * @param dirPath The absolute path to the directory to check.
     * @returns `true` if the directory is considered empty or safe, `false` otherwise.
     */
    async isDirectoryEmptyOrSafe(dirPath: string): Promise<boolean> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!SAFE_TO_IGNORE_FOR_EMPTY_CHECK.has(entry.name)) {
                    // Found a file/directory that is not on the safe list
                    console.log(chalk.dim(`  Directory check: Found potentially important item '${entry.name}'. Not considered empty/safe.`));
                    return false;
                }
            }
            // If loop completes without finding unsafe items, it's empty or safe
            console.log(chalk.dim(`  Directory check: Directory is empty or contains only safe-to-ignore items.`));
            return true;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // If the directory doesn't exist, it's definitely "empty" for our purposes
                 console.log(chalk.dim(`  Directory check: Directory '${dirPath}' does not exist. Considered empty/safe.`));
                return true;
            }
            // Log and re-throw other errors during readdir
            console.error(chalk.red(`Error checking directory contents of '${dirPath}':`), error);
            throw error;
        }
    }


    /**
     * Ensures the specific .kai/logs directory exists.
     * Separated from Config loading, called after potential user confirmation.
     * @param kaiLogsDir The absolute path to the .kai/logs directory.
     */
    async ensureKaiDirectoryExists(kaiLogsDir: string): Promise<void> {
        try {
             // Check if it exists first to avoid unnecessary log message
             await fs.access(kaiLogsDir);
             console.log(chalk.dim(`  Log directory already exists: ${kaiLogsDir}`));
        } catch (error) {
             if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                 console.log(chalk.yellow(`  Log directory not found. Creating: ${kaiLogsDir}...`));
                 await fs.mkdir(kaiLogsDir, { recursive: true });
                 console.log(chalk.green(`  Successfully created log directory: ${kaiLogsDir}`));
             } else {
                 console.error(chalk.red(`Error checking/creating log directory ${kaiLogsDir}:`), error);
                 throw error; // Rethrow critical errors
             }
        }
    }


    /**
     * Ensures .gitignore exists and contains the rule to ignore '.kai/logs/'.
     * Creates the file with defaults if missing, appends the rule if missing from an existing file.
     * Called *after* user confirmation if needed (when no .git exists).
     * @param projectRoot The root directory of the project.
     */
    async ensureGitignoreRules(projectRoot: string): Promise<void> {
        console.log(chalk.dim("  Ensuring .gitignore configuration..."));
        const gitignorePath = path.join(projectRoot, '.gitignore');
        const kaiLogsIgnoreLine = '.kai/logs/'; // Trailing slash ignores directory + contents
        const kaiLogsComment = '# Kai specific logs (auto-added)';
        const defaultNewGitignoreContent = `# Common Node ignores\nnode_modules/\n.DS_Store\n\n${kaiLogsComment}\n${kaiLogsIgnoreLine}\n`;

        try {
            let gitignoreContent = await this.readFile(gitignorePath); // Returns null if ENOENT

            if (gitignoreContent === null) {
                // --- .gitignore does NOT exist - CREATE IT ---
                console.log(chalk.yellow(`    .gitignore not found. Creating one with rule '${kaiLogsIgnoreLine}'...`));
                try {
                    await this.writeFile(gitignorePath, defaultNewGitignoreContent);
                    console.log(chalk.green(`    Successfully created .gitignore.`));
                } catch (writeError) {
                    console.error(chalk.red(`    Error creating .gitignore file at ${gitignorePath}:`), writeError);
                    // Throw or handle more gracefully? Log and continue for now.
                }
            } else {
                // --- .gitignore DOES exist - CHECK & APPEND if needed ---
                console.log(chalk.dim(`    Found existing .gitignore file. Checking for rule...`));
                const lines = gitignoreContent.split('\n').map(line => line.trim());
                const ruleExists = lines.includes(kaiLogsIgnoreLine);

                if (!ruleExists) {
                    console.log(chalk.yellow(`    Rule '${kaiLogsIgnoreLine}' not found in .gitignore. Appending it...`));
                    try {
                        const contentToAppend = (gitignoreContent.endsWith('\n') ? '' : '\n')
                                                + `\n${kaiLogsComment}\n${kaiLogsIgnoreLine}\n`;
                        await fs.appendFile(gitignorePath, contentToAppend, 'utf-8');
                        console.log(chalk.green(`    Successfully appended '${kaiLogsIgnoreLine}' to .gitignore.`));
                    } catch (appendError) {
                        console.error(chalk.red(`    Error appending '${kaiLogsIgnoreLine}' to .gitignore at ${gitignorePath}:`), appendError);
                    }
                } else {
                    console.log(chalk.dim(`    Rule '${kaiLogsIgnoreLine}' already present.`));
                }
            }
        } catch (readError) {
            // Catch errors from readFile *other* than ENOENT
            console.error(chalk.red(`    Error processing .gitignore file at ${gitignorePath}:`), readError);
        }
        console.log(chalk.dim("  .gitignore configuration ensure complete."));
    }

    /**
     * Reads .gitignore rules for in-memory filtering during context building.
     * Does NOT create or modify the file itself. Always includes default ignores.
     * @param projectRoot The root directory of the project.
     * @returns An `ignore` instance populated with rules.
     */
    private async readGitignoreForContext(projectRoot: string): Promise<Ignore> {
        const ig = ignore();
        const gitignorePath = path.join(projectRoot, '.gitignore');
        const kaiLogsIgnoreLine = '.kai/logs/';

        // --- Step 1: Always add essential *in-memory* ignores ---
        ig.add(['.git', 'node_modules', '.gitignore', kaiLogsIgnoreLine]);

        // --- Step 2: Read the actual file IF it exists ---
        try {
            const gitignoreContent = await this.readFile(gitignorePath); // Returns null if ENOENT
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

        // --- Step 3: Return the in-memory ignore object ---
        return ig;
    }

    // --- Project file reading methods (MODIFIED getProjectFiles) ---

    // getProjectFiles, readFileContents, isTextFile (remain unchanged except call to readGitignoreForContext)
    async getProjectFiles(dirPath: string, projectRoot?: string, ig?: Ignore): Promise<string[]> {
        projectRoot = projectRoot || dirPath;
        // --- MODIFICATION: Call the read-only version ---
        ig = ig || await this.readGitignoreForContext(projectRoot);
        // --- END MODIFICATION ---

        let files: string[] = [];
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(projectRoot, fullPath);

            if (ig.ignores(entry.name) || ig.ignores(relativePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                files = files.concat(await this.getProjectFiles(fullPath, projectRoot, ig));
            } else if (await this.isTextFile(fullPath)) {
                files.push(fullPath);
            }
        }
        return files;
    }

    async readFileContents(filePaths: string[]): Promise<{ [filePath: string]: string }> {
        const contents: { [filePath: string]: string } = {};
        for (const filePath of filePaths) {
            const content = await this.readFile(filePath);
            if (content !== null) {
                contents[filePath] = content;
            } else {
                console.warn(chalk.yellow(`Skipping file not found or unreadable during content read: ${filePath}`));
            }
        }
        return contents;
    }

     async isTextFile(filePath: string): Promise<boolean> {
        const textExtensions = ['.ts', '.js', '.json', '.yaml', '.yml', '.txt', '.md', '.html', '.css', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.rb', '.php', '.go', '.rs', '.swift', '.kt', '.kts', '.gitignore', '.npmignore', 'LICENSE', '.env', '.xml', '.svg', '.jsx', '.tsx'];
        const ext = path.extname(filePath).toLowerCase();
        const base = path.basename(filePath);
        return textExtensions.includes(ext) || ['Dockerfile', 'Makefile', 'README'].includes(base);
    }
    // --- End project file reading methods ---

    // --- JSONL/Directory methods (remain unchanged) ---
    async ensureDirExists(dirPath: string): Promise<void> {
        try {
            await fs.access(dirPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                // Log moved out, only perform mkdir here
                await fs.mkdir(dirPath, { recursive: true });
            } else {
                console.error(`Error checking/creating directory ${dirPath}:`, error);
                throw error;
            }
        }
    }

    async listJsonlFiles(dirPath: string): Promise<string[]> {
        // Ensure dir exists before listing, but use the dedicated method for consistency
        await this.ensureKaiDirectoryExists(dirPath); // Ensure .kai/logs exists if needed
        try {
            // await this.ensureDirExists(dirPath); // redundant if ensureKaiDirectoryExists was called
            const files = await fs.readdir(dirPath);
            return files
                .filter(file => file.endsWith('.jsonl'))
                .map(file => path.basename(file, '.jsonl'));
        } catch (error) {
            // EnsureKaiDirectoryExists handles ENOENT, so this catch is for other readdir errors
             console.error(chalk.red(`Error listing files in ${dirPath}:`), error);
             return []; // Return empty on error
        }
    }

    async readJsonlFile(filePath: string): Promise<any[]> {
        try {
            await fs.access(filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return [];
            }
            console.error(`Error accessing file ${filePath} for reading:`, error);
            throw error;
        }

        try {
            const content = await this.readFile(filePath);
            if (!content || !content.trim()) {
                return [];
            }
            return content
                .trim()
                .split('\n')
                .map(line => JSON.parse(line));
        } catch (error) {
            console.error(`Error reading or parsing JSONL file ${filePath}:`, error);
            throw new Error(`Failed to parse ${filePath}. Check its format.`);
        }
    }

    async appendJsonlFile(filePath: string, data: object): Promise<void> {
        const logEntry = JSON.stringify(data) + '\n';
        try {
            const dir = path.dirname(filePath);
            // Use ensureDirExists here, assuming the log file might be elsewhere
            // But typically it will be in .kai/logs which should already exist
            await this.ensureDirExists(dir);
            await fs.appendFile(filePath, logEntry, 'utf-8');
        } catch (error) {
            console.error(`Error appending to JSONL file ${filePath}:`), error);
            throw error;
        }
    }
    // --- END JSONL/Directory methods ---
}

export { FileSystem };