import fs from 'fs/promises';
import path from 'path';
import ignore from 'ignore';

class FileSystem {
    async getProjectFiles(projectRoot) {
        const gitignorePath = path.join(projectRoot, '.gitignore');
        let gitignoreContent = '';
        try {
            gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
        } catch (error) {
            console.log('.gitignore file not found or unreadable, skipping.');
            // It's OK if .gitignore doesn't exist.
        }

        const ig = ignore().add(gitignoreContent);

        const ignorePatterns = [
            'node_modules', // No trailing slash, handles both file and directory
            '.git',
            '.idea',
            '.vscode',
            'dist',
            'build',
            'coverage',
            '.*.swp', // simplified form of your regex
            '~'
        ];

        ig.add(ignorePatterns);


        const isRelevant = (filePath, isDirectory = false) => {
            const relativePath = path.relative(projectRoot, filePath);
            //  Check if it's a directory and if it's ignored directly.
            if (isDirectory) {
                for (const pattern of ignorePatterns) {
                    if (relativePath === pattern || relativePath.startsWith(pattern + path.sep)) { //Crucial: path.sep for cross-platform
                        return false;
                    }
                }
            }

            return !ig.ignores(relativePath);
        };

        const files = [];

        const findFiles = async (dir) => {
            const items = await fs.readdir(dir, { withFileTypes: true });

            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                const relativePath = path.relative(projectRoot, fullPath);

                if (item.isDirectory()) {
                    // Early check for directory exclusion
                    if (!isRelevant(fullPath, true)) {
                        console.log(`Skipping directory (gitignore - full exclusion): ${relativePath}`);
                        continue; // Skip the entire directory
                    }
                    await findFiles(fullPath); // Proceed if not fully excluded

                } else if (item.isFile()) {
                    if (isRelevant(fullPath)) {
                        files.push(fullPath);
                    } else {
                        console.log(`Skipping file (gitignore): ${relativePath}`);
                    }
                }
            }
        };

        await findFiles(projectRoot);
        return files;
    }

    // ... (rest of FileSystem.js methods remain the same) ...

    async readFileContents(filePaths) {
        const fileContents = {};
        for (const filePath of filePaths) {
            try {
                if (await this.isTextFile(filePath)) { // Check if it's a text file
                    const content = await fs.readFile(filePath, 'utf-8');
                    fileContents[filePath] = content;
                } else {
                    console.log(`Skipping binary file: ${filePath}`); // Log skipped files
                }
            } catch (error) {
                console.error(`Error reading file ${filePath}: ${error.message}`);
                // Don't throw here; continue with other files
            }
        }
        return fileContents;
    }

    async writeFile(filePath, content) {
        try {
            await fs.writeFile(filePath, content);
        } catch (error) {
            console.error(`Error writing file ${filePath}: ${error}`);
            throw error; // Re-throw to handle it higher up
        }
    }

    async deleteFile(filePath) {
        if (filePath) {
            try {
                const stats = await fs.stat(filePath).catch(() => null); // Check if file exists without throwing
                if (stats && stats.isFile()) { // Check if it's a file
                    await fs.unlink(filePath);
                    console.log(`Deleted file: ${filePath}`);
                } else {
                    console.log(`File does not exist: ${filePath}`);
                }
            } catch (error) {
                console.error(`Error deleting file ${filePath}: ${error}`);
                throw error; // Re-throw
            }
        }
    }

    async readFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        }
        catch(error) {
            console.error(`Error reading file in readFile: ${filePath} : ${error}`);
            return null; //Don't re-throw.
        }
    }
    async isTextFile(filePath) {
        try {
            const buffer = await fs.readFile(filePath, { length: 1024 }); // Read first 1024 bytes
            const textExtensions = ['.txt', '.js', '.ts', '.jsx', '.py', '.java', '.cpp', '.h', '.html', '.css', '.json', '.xml', '.md', '.yaml', '.yml', '.sh', '.config', '.log', '.csv', '.tsv']; // Add more as needed.
            const ext = path.extname(filePath).toLowerCase();

            if (textExtensions.includes(ext)) { // Check extension first
                return true;
            }

            // Check for null bytes in the buffer (heuristic for binary files)
            return !buffer.includes(0);

        } catch (error) {
            console.error(`Error checking if file is text: ${filePath}`, error);
            return false; // Assume non-text if there's an error (e.g., file not found)
        }
    }
}

export { FileSystem };