// File: src/lib/FileSystem.ts
import fsPromises from 'fs/promises'; // Use promises API
import { Stats } from 'fs'; // Import Stats type from base 'fs'
import path from 'path';
import ignore, { Ignore } from 'ignore'; // Import ignore type as well
import chalk from 'chalk'; // Import chalk for logging

// --- ADDED: Import Analysis Cache Types ---
// Import M2 structure
import { ProjectAnalysisCache, AnalysisCacheEntry } from './analysis/types'; // Adjust path if needed

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
        await fsPromises.access(filePath);
    }

    async deleteFile(filePath: string): Promise<void> {
        await fsPromises.unlink(filePath);
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        const dir = path.dirname(filePath);
        await this.ensureDirExists(dir);
        await fsPromises.writeFile(filePath, content, 'utf-8');
    }

    async readFile(filePath: string): Promise<string | null> {
        try {
            const content = await fsPromises.readFile(filePath, 'utf-8');
            return content;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null; // Return null if file doesn't exist
            }
            console.error(chalk.red(`Error reading file ${filePath}:`), error);
            throw error; // Rethrow other errors
        }
    }

    /**
     * Gets file status information.
     * @param filePath The path to the file.
     * @returns A promise resolving to the Stats object, or null if the file doesn't exist.
     */
    async stat(filePath: string): Promise<Stats | null> {
        try {
            return await fsPromises.stat(filePath);
        } catch (error) {
             if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
             console.error(chalk.red(`Error getting stats for file ${filePath}:`), error);
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
            const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
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
     * Ensures the specified directory exists. Used for logs, cache, etc.
     * @param dir The absolute path to the directory.
     */
    async ensureDirExists(dir: string): Promise<void> {
        try {
             // Check if it exists first to avoid unnecessary log message
             await fsPromises.access(dir);
             // console.log(chalk.dim(`  Directory already exists: ${dir}`)); // Maybe too verbose
        } catch (error) {
             if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                 console.log(chalk.yellow(`  Directory not found. Creating: ${dir}...`));
                 await fsPromises.mkdir(dir, { recursive: true });
                 console.log(chalk.green(`  Successfully created directory: ${dir}`));
             } else {
                 console.error(chalk.red(`Error checking/creating directory ${dir}:`), error);
                 throw error; // Rethrow critical errors
             }
        }
    }

    // --- *** REMOVED ensureGitignoreRules method *** ---
    // This functionality is now in GitService.

    // --- *** REMOVED readGitignoreForContext method *** ---
    // This functionality is now in GitService as getIgnoreRules.

    /**
     * Ensures the specific .kai/logs directory exists.
     * Convenience method calling ensureDirExists.
     * @param kaiLogsDir The absolute path to the .kai/logs directory.
     */
    async ensureKaiDirectoryExists(kaiLogsDir: string): Promise<void> {
         await this.ensureDirExists(kaiLogsDir); // Reuse the generic ensureDirExists
    }

    // --- Project file reading methods ---

    /**
     * Recursively lists all text files in a directory, respecting ignore rules provided by the caller.
     * @param dirPath The directory to start searching from.
     * @param projectRoot The root of the project, used for relative path calculations in ignore rules.
     * @param ig An `ignore` instance, usually obtained from GitService.getIgnoreRules().
     * @returns A promise resolving to an array of absolute file paths.
     * @throws Error if `ig` is not provided.
     */
    async getProjectFiles(dirPath: string, projectRoot?: string, ig?: Ignore): Promise<string[]> {
        projectRoot = projectRoot || dirPath;
        // The caller (e.g., ProjectContextBuilder) is responsible for obtaining
        // the Ignore object from GitService and passing it here.
        if (!ig) {
             // If no ignore object is passed, we cannot respect .gitignore rules.
             throw new Error("getProjectFiles requires an Ignore object from GitService.getIgnoreRules() to be passed by the caller.");
        }

        let files: string[] = [];
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            // Important: Use relative path from projectRoot for ignore checks
            const relativePath = path.relative(projectRoot, fullPath);

            // Check against the provided ignore rules using the relative path
            if (ig.ignores(relativePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                // Recursively call with the same projectRoot and ig object
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
        // Added '.' check for dotfiles without extensions that might be text (like .env, .gitignore)
        // Check for binary types by content sniffing (basic)
        try {
            const buffer = Buffer.alloc(512);
            const fd = await fsPromises.open(filePath, 'r');
            const { bytesRead } = await fd.read(buffer, 0, 512, 0);
            await fd.close();
            if (bytesRead === 0) return true; // Empty file is considered text

            // Check for common null bytes or control characters often found in binary files
            for (let i = 0; i < bytesRead; i++) {
                if (buffer[i] === 0) return false; // Null byte likely indicates binary
            }

            // If it has a known text extension OR passes the binary check, consider it text
            return textExtensions.includes(ext) || ['Dockerfile', 'Makefile', 'README'].includes(base) || (base.startsWith('.') && !ext) || true; // Default to text if no binary indicators found

        } catch (error) {
            // If we can't read the file (e.g., permissions), default to assuming text for safety,
            // but log the error. The analysis phase might reclassify it later.
            console.warn(chalk.yellow(`Warning: Could not read start of file ${filePath} for text check. Assuming text. Error: ${(error as Error).message}`));
            return true;
        }
    }
    // --- End project file reading methods ---

    // --- JSONL/Directory methods ---

    async listJsonlFiles(dirPath: string): Promise<string[]> {
        // Ensure the directory exists first using the generic method
        // It's the caller's responsibility (like UserInterface) to ensure this is the *correct* dir (e.g., config.chatsDir)
        await this.ensureDirExists(dirPath);

        // Proceed with listing
        try {
            const files = await fsPromises.readdir(dirPath);
            return files
                .filter(file => file.endsWith('.jsonl'))
                .map(file => path.basename(file, '.jsonl'));
        } catch (error) {
            // EnsureDirExists handles ENOENT, so this catch is for other readdir errors
             console.error(chalk.red(`Error listing files in ${dirPath}:`), error);
             return []; // Return empty on error
        }
    }

    async readJsonlFile(filePath: string): Promise<any[]> {
        try {
            await fsPromises.access(filePath);
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
            await fsPromises.appendFile(filePath, logEntry, 'utf-8');
        } catch (error) {
            console.error(`Error appending to JSONL file ${filePath}:`, error);
            throw error;
        }
    }
    // --- END JSONL/Directory methods ---

    // --- ADDED: Analysis Cache Methods (Milestone 2 - Object Structure) ---

    /**
     * Reads the project analysis cache file (expects M2 structure: { overallSummary, entries }).
     * @param cachePath The absolute path to the cache file.
     * @returns The parsed cache data (ProjectAnalysisCache), or null if the file doesn't exist or is invalid.
     */
    async readAnalysisCache(cachePath: string): Promise<ProjectAnalysisCache | null> {
        console.log(chalk.dim(`Attempting to read analysis cache: ${cachePath}`));
        try {
            const content = await this.readFile(cachePath);
            if (content === null) {
                console.log(chalk.dim(`Analysis cache file not found.`));
                return null;
            }
            const data: unknown = JSON.parse(content); // Parse as unknown first

            // --- M2 Validation: Check for new structure ---
            if (
                typeof data !== 'object' ||
                data === null ||
                (typeof (data as any).overallSummary !== 'string' && (data as any).overallSummary !== null) || // Allow null for M2
                !Array.isArray((data as any).entries)
            ) {
                console.warn(chalk.yellow(`Warning: Analysis cache file at ${cachePath} does not match expected structure { overallSummary: string|null, entries: [...] }. Ignoring.`));
                return null;
            }
            // --- End M2 Validation ---

            // Optional: Add more detailed validation of array elements ((data as any).entries) if needed later

            console.log(chalk.dim(`Successfully read and parsed M2 analysis cache (${(data as any).entries.length} entries).`));
            return data as ProjectAnalysisCache; // Type assertion to the new structure

        } catch (error) {
            console.error(chalk.red(`Error reading or parsing analysis cache file ${cachePath}:`), error);
            return null;
        }
    }

    /**
     * Writes the project analysis data (M2 object structure) to the cache file.
     * @param cachePath The absolute path to the cache file.
     * @param cacheData The analysis data (ProjectAnalysisCache) to write.
     */
    async writeAnalysisCache(cachePath: string, cacheData: ProjectAnalysisCache): Promise<void> {
        // --- M2 Validation ---
        // Basic check for the expected object structure
        if (typeof cacheData !== 'object' || cacheData === null || !Array.isArray(cacheData.entries)) {
            console.error(chalk.red(`Attempted to write invalid cache data structure (expected object with 'entries' array for M2) to ${cachePath}. Aborting write.`));
            return; // Prevent writing bad data
        }
        // --- End M2 Validation ---
        try {
             console.log(chalk.dim(`Writing analysis cache to: ${cachePath} (${cacheData.entries.length} entries)`));
             const content = JSON.stringify(cacheData, null, 2); // Pretty-print JSON
             await this.writeFile(cachePath, content);
             console.log(chalk.dim(`Successfully wrote analysis cache.`));
        } catch (error) {
             console.error(chalk.red(`Error writing analysis cache file ${cachePath}:`), error);
             // Decide if this should re-throw or just log
        }
    }
    // --- END Analysis Cache Methods ---
}

export { FileSystem };