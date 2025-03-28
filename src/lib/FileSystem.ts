// File: src/lib/FileSystem.ts
import fs from 'fs/promises'; // Ensure using promises
import path from 'path';
import ignore, { Ignore } from 'ignore'; // Import Ignore type as well
// Remove Message import if not used directly here, it was likely for a previous version
// import { Message } from './models/Conversation';

class FileSystem {

    // --- Add back common FS methods ---
    async access(filePath: string): Promise<void> {
        await fs.access(filePath);
    }

    async deleteFile(filePath: string): Promise<void> {
        await fs.unlink(filePath);
    }

    async writeFile(filePath: string, content: string): Promise<void> {
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
            console.error(`Error reading file ${filePath}:`, error);
            throw error; // Rethrow other errors
        }
    }
    // --- End common FS methods ---


    // --- Add back project file reading methods (implementing gitignore logic) ---
    private async readGitignore(projectRoot: string): Promise<Ignore> {
        const ig = ignore();
        const gitignorePath = path.join(projectRoot, '.gitignore');
        try {
            const gitignoreContent = await this.readFile(gitignorePath);
            if (gitignoreContent) {
                // Add default ignores and project-specific ones
                ig.add(['.git', 'node_modules', '.gitignore', '.kaichats']); // Add common defaults
                ig.add(gitignoreContent);
            }
        } catch (error) {
            // Ignore error if .gitignore doesn't exist
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn("Warning: Could not read .gitignore:", error);
            } else {
                // Still add defaults even if no .gitignore
                ig.add(['.git', 'node_modules', '.gitignore']);
            }
        }
        return ig;
    }

    async getProjectFiles(dirPath: string, projectRoot?: string, ig?: Ignore): Promise<string[]> {
        projectRoot = projectRoot || dirPath; // Set projectRoot on initial call
        ig = ig || await this.readGitignore(projectRoot); // Load ignore rules once

        let files: string[] = [];
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(projectRoot, fullPath);

            // Skip if ignored
            if (ig.ignores(relativePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                files = files.concat(await this.getProjectFiles(fullPath, projectRoot, ig));
            } else if (await this.isTextFile(fullPath)) { // Check if it's likely a text file
                files.push(fullPath);
            }
        }
        return files;
    }

    async readFileContents(filePaths: string[]): Promise<{ [filePath: string]: string }> {
        const contents: { [filePath: string]: string } = {};
        for (const filePath of filePaths) {
            const content = await this.readFile(filePath);
            if (content !== null) { // Only add if file was read successfully
                contents[filePath] = content;
            } else {
                console.warn(`Skipping file not found or unreadable: ${filePath}`);
            }
        }
        return contents;
    }

    async isTextFile(filePath: string): Promise<boolean> {
        // Basic check based on extension - can be improved
        const textExtensions = ['.ts', '.js', '.json', '.yaml', '.yml', '.txt', '.md', '.html', '.css', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.rb', '.php', '.go', '.rs', '.swift', '.kt', '.kts', '.gitignore', '.npmignore', 'LICENSE', '.env', '.xml', '.svg', '.jsx', '.tsx'];
        const ext = path.extname(filePath).toLowerCase();
        const base = path.basename(filePath);

        // Check extension or if it's a common config file without extension
        return textExtensions.includes(ext) || ['Dockerfile', 'Makefile', 'README'].includes(base);
        // Avoid reading binary files by default
    }
    // --- End project file reading methods ---


    // --- NEW METHODS (Keep as they were) ---
    async ensureDirExists(dirPath: string): Promise<void> {
        try {
            await fs.access(dirPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                await fs.mkdir(dirPath, { recursive: true });
                console.log(`Created directory: ${dirPath}`);
            } else {
                console.error(`Error checking/creating directory ${dirPath}:`, error);
                throw error;
            }
        }
    }

    async listJsonlFiles(dirPath: string): Promise<string[]> {
        try {
            await this.ensureDirExists(dirPath); // Make sure directory exists first
            const files = await fs.readdir(dirPath);
            return files
                .filter(file => file.endsWith('.jsonl'))
                .map(file => path.basename(file, '.jsonl')); // Return just the names without extension
        } catch (error) {
            console.error(`Error listing files in ${dirPath}:`, error);
            return []; // Return empty array on error
        }
    }

    async readJsonlFile(filePath: string): Promise<any[]> { // Returns array of parsed JSON objects
        try {
            // Check if file exists, return empty array if not (for new conversations)
            await fs.access(filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return []; // File doesn't exist, it's a new conversation
            }
            console.error(`Error accessing file ${filePath} for reading:`, error);
            throw error; // Rethrow other errors
        }

        try {
            const content = await this.readFile(filePath); // Use the class's readFile
            if (!content || !content.trim()) {
                return []; // File is empty or couldn't be read
            }
            return content
                .trim()
                .split('\n')
                .map(line => JSON.parse(line));
        } catch (error) {
            console.error(`Error reading or parsing JSONL file ${filePath}:`, error);
            // Decide how to handle parse errors - skip line, throw, etc.
            // For simplicity, we'll throw for now.
            throw new Error(`Failed to parse ${filePath}. Check its format.`);
        }
    }

    async appendJsonlFile(filePath: string, data: object): Promise<void> {
        const logEntry = JSON.stringify(data) + '\n';
        try {
            const dir = path.dirname(filePath);
            await this.ensureDirExists(dir); // Ensure directory exists before appending
            await fs.appendFile(filePath, logEntry, 'utf-8');
        } catch (error) {
            console.error(`Error appending to JSONL file ${filePath}:`, error);
            throw error;
        }
    }
    // --- END NEW METHODS ---
}

export { FileSystem };