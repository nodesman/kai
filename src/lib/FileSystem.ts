// File: src/lib/FileSystem.ts
import fs from 'fs/promises'; // Ensure using promises
import path from 'path';
import ignore, { Ignore } from 'ignore'; // Import Ignore type as well
import chalk from 'chalk'; // Import chalk for logging

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
     * Ensures .gitignore exists and contains the rule to ignore '.kai/logs/'.
     * Creates the file with defaults if missing, appends the rule if missing from an existing file.
     * Should be called once during application startup.
     * @param projectRoot The root directory of the project.
     */
    async ensureGitignoreRules(projectRoot: string): Promise<void> {
        console.log(chalk.dim("Checking .gitignore configuration..."));
        const gitignorePath = path.join(projectRoot, '.gitignore');
        const kaiLogsIgnoreLine = '.kai/logs/'; // Trailing slash ignores directory + contents
        const kaiLogsComment = '# Kai specific logs (auto-added)';
        const defaultNewGitignoreContent = `# Common Node ignores\nnode_modules/\n.DS_Store\n\n${kaiLogsComment}\n${kaiLogsIgnoreLine}\n`;

        try {
            let gitignoreContent = await this.readFile(gitignorePath); // Returns null if ENOENT

            if (gitignoreContent === null) {
                // --- .gitignore does NOT exist - CREATE IT ---
                console.log(chalk.yellow(`  .gitignore not found. Creating one with defaults including '${kaiLogsIgnoreLine}'...`));
                try {
                    await this.writeFile(gitignorePath, defaultNewGitignoreContent);
                    console.log(chalk.green(`  Successfully created .gitignore.`));
                } catch (writeError) {
                    console.error(chalk.red(`  Error creating .gitignore file at ${gitignorePath}:`), writeError);
                    // Throw or handle more gracefully? For now, log and continue startup.
                    // Depending on severity, you might want to throw new Error(...) here.
                }
            } else {
                // --- .gitignore DOES exist - CHECK & APPEND if needed ---
                console.log(chalk.dim(`  Found existing .gitignore file.`));
                const lines = gitignoreContent.split('\n').map(line => line.trim());
                const ruleExists = lines.includes(kaiLogsIgnoreLine);

                if (!ruleExists) {
                    console.log(chalk.yellow(`  Rule '${kaiLogsIgnoreLine}' not found in .gitignore. Appending it...`));
                    try {
                        const contentToAppend = (gitignoreContent.endsWith('\n') ? '' : '\n')
                                                + `\n${kaiLogsComment}\n${kaiLogsIgnoreLine}\n`;
                        await fs.appendFile(gitignorePath, contentToAppend, 'utf-8');
                        console.log(chalk.green(`  Successfully appended '${kaiLogsIgnoreLine}' to .gitignore.`));
                    } catch (appendError) {
                        console.error(chalk.red(`  Error appending '${kaiLogsIgnoreLine}' to .gitignore file at ${gitignorePath}:`), appendError);
                        // Log and continue startup.
                    }
                } else {
                    console.log(chalk.dim(`  Rule '${kaiLogsIgnoreLine}' already present in .gitignore.`));
                }
            }
        } catch (readError) {
            // Catch errors from readFile *other* than ENOENT
            console.error(chalk.red(`  Error processing .gitignore file at ${gitignorePath}:`), readError);
            // Log and continue startup.
        }
        console.log(chalk.dim("  .gitignore configuration check complete."));
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
        // Ensures the tool behaves correctly for context building regardless of file state.
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
            // Continue with default in-memory ignores anyway
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

            // Check against absolute path for initial system dirs like .git
            // and relative path for rules defined in .gitignore
            if (ig.ignores(entry.name) || ig.ignores(relativePath)) {
                 // console.log(chalk.gray(`    Ignoring: ${relativePath}`)); // Optional verbose logging
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
        // This simple heuristic remains the same
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
                await fs.mkdir(dirPath, { recursive: true });
                // Log moved to Config constructor where .kai/logs is created
            } else {
                console.error(`Error checking/creating directory ${dirPath}:`, error);
                throw error;
            }
        }
    }

    async listJsonlFiles(dirPath: string): Promise<string[]> {
        try {
            await this.ensureDirExists(dirPath);
            const files = await fs.readdir(dirPath);
            return files
                .filter(file => file.endsWith('.jsonl'))
                .map(file => path.basename(file, '.jsonl'));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error(`Error listing files in ${dirPath}:`, error);
            }
            return [];
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
            await this.ensureDirExists(dir);
            await fs.appendFile(filePath, logEntry, 'utf-8');
        } catch (error) {
            console.error(`Error appending to JSONL file ${filePath}:`, error);
            throw error;
        }
    }
    // --- END JSONL/Directory methods ---
}

export { FileSystem };