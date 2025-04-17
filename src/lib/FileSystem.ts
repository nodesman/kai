// File: src/lib/FileSystem.ts
import fs from 'fs/promises'; // Ensure using promises
import path from 'path';
import ignore, { Ignore } from 'ignore'; // Import Ignore type as well
import chalk from 'chalk'; // Import chalk for logging

class FileSystem {

    // --- Common FS methods (ensure writeFile uses ensureDirExists) ---
    async access(filePath: string): Promise<void> {
        await fs.access(filePath);
    }

    async deleteFile(filePath: string): Promise<void> {
        await fs.unlink(filePath);
    }

    /**
     * Writes content to a file, ensuring the directory exists first.
     * @param filePath The absolute path to the file.
     * @param content The string content to write.
     */
    async writeFile(filePath: string, content: string): Promise<void> {
        // Ensure directory exists before writing
        const dir = path.dirname(filePath);
        // Use ensureDirExists from this class (which uses async fs.mkdir)
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

    // --- Project file reading methods (MODIFIED gitignore logic AGAIN) ---

    /**
     * Reads .gitignore, creates it with defaults if missing, appends '.kai/logs/' if missing
     * from an existing file, and returns ignore rules for in-memory filtering.
     * Ensures `.kai/logs/` is always ignored *in memory* for the tool's context building.
     * @param projectRoot The root directory of the project.
     * @returns An `ignore` instance populated with rules.
     */
    private async readGitignore(projectRoot: string): Promise<Ignore> {
        const ig = ignore();
        const gitignorePath = path.join(projectRoot, '.gitignore');
        // Define the specific line to ensure exists in the .gitignore file
        const kaiLogsIgnoreLine = '.kai/logs/'; // Trailing slash ignores directory + contents
        const kaiLogsComment = '# Kai specific logs (auto-added)'; // Comment to add when appending

        // Define default base content for a *new* .gitignore file
        const defaultNewGitignoreContent = `# Common Node ignores\nnode_modules/\n.DS_Store\n\n${kaiLogsComment}\n${kaiLogsIgnoreLine}\n`;

        // --- Step 1: Always add essential *in-memory* ignores ---
        // Ensures the tool behaves correctly for context building regardless of file state.
        ig.add(['.git', 'node_modules', '.gitignore', kaiLogsIgnoreLine]); // Use the constant

        try {
            let gitignoreContent = await this.readFile(gitignorePath); // Returns null if ENOENT

            if (gitignoreContent === null) {
                // --- Step 2a: .gitignore does NOT exist - CREATE IT ---
                console.log(chalk.yellow(`  .gitignore not found. Creating one with defaults...`));
                try {
                    // Write the default content (which includes kaiLogsIgnoreLine)
                    await this.writeFile(gitignorePath, defaultNewGitignoreContent);
                    console.log(chalk.green(`  Successfully created .gitignore and added rule for '${kaiLogsIgnoreLine}'.`));
                    // The in-memory 'ig' object already includes this rule.
                } catch (writeError) {
                    console.error(chalk.red(`  Error creating .gitignore file at ${gitignorePath}:`), writeError);
                    // Continue with in-memory ignores anyway
                }
            } else {
                // --- Step 2b: .gitignore *DOES* exist - READ & CHECK ---
                console.log(chalk.dim(`  Using existing .gitignore file.`));
                // Add existing content to in-memory rules first
                ig.add(gitignoreContent);

                // --- Check if the specific line exists (more robust check) ---
                const lines = gitignoreContent.split('\n').map(line => line.trim());
                const ruleExists = lines.includes(kaiLogsIgnoreLine);

                if (!ruleExists) {
                    // --- Append the rule if it's missing ---
                    console.log(chalk.yellow(`  Rule '${kaiLogsIgnoreLine}' not found in existing .gitignore. Appending it...`));
                    try {
                        // Append the rule with a preceding newline (if needed) and a comment
                        const contentToAppend = (gitignoreContent.endsWith('\n') ? '' : '\n') // Add newline if file doesn't end with one
                                                + `\n${kaiLogsComment}\n${kaiLogsIgnoreLine}\n`; // Add comment, rule, and trailing newline
                        await fs.appendFile(gitignorePath, contentToAppend, 'utf-8');
                        console.log(chalk.green(`  Successfully appended '${kaiLogsIgnoreLine}' to .gitignore.`));
                        // The in-memory 'ig' object already includes this rule from Step 1.
                    } catch (appendError) {
                         console.error(chalk.red(`  Error appending '${kaiLogsIgnoreLine}' to .gitignore file at ${gitignorePath}:`), appendError);
                         // In-memory ignore still works because of Step 1.
                    }
                } else {
                     console.log(chalk.dim(`  Rule '${kaiLogsIgnoreLine}' already present in .gitignore.`));
                }
            }
        } catch (readError) {
            // Catch errors from readFile *other* than ENOENT (which returns null)
            console.error(chalk.red(`  Error processing .gitignore file at ${gitignorePath}:`), readError);
            // Continue with in-memory ignores anyway (Step 1 ensures this)
        }

        // --- Step 3: Return the in-memory ignore object ---
        // This object contains both default ignores and any rules read from the file.
        return ig;
    }


    // getProjectFiles, readFileContents, isTextFile (remain unchanged)
    async getProjectFiles(dirPath: string, projectRoot?: string, ig?: Ignore): Promise<string[]> {
        projectRoot = projectRoot || dirPath;
        // This call now creates/appends to .gitignore if necessary
        ig = ig || await this.readGitignore(projectRoot);

        let files: string[] = [];
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(projectRoot, fullPath);

            if (ig.ignores(relativePath)) {
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
                console.warn(`Skipping file not found or unreadable: ${filePath}`);
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

    // --- JSONL/Directory methods (ensureDirExists uses async mkdir) ---
    async ensureDirExists(dirPath: string): Promise<void> {
        try {
            await fs.access(dirPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                // recursive: true handles nested creation like .kai/logs
                await fs.mkdir(dirPath, { recursive: true });
                // Avoid duplicate logs here if Config.ts also logs creation
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