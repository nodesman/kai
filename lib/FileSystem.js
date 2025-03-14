// lib/FileSystem.js
import fs from 'fs/promises';
import path from 'path';

class FileSystem {
    async getProjectFiles(projectRoot) {
        const ignorePatterns = [
            /^node_modules$/,
            /^\.git$/,
            /^\.idea$/,
            /^\.vscode$/,
            /^dist$/,
            /^build$/,
            /^coverage$/,  // Add more as needed
            /^\..*\.swp$/, //Vim swap files
            /~$/ //Emacs backup files
        ];

        const isRelevant = (name) => {
            return !ignorePatterns.some(pattern => pattern.test(name));
        };

        const files = [];

        const findFiles = async (dir) => {
            const items = await fs.readdir(dir, { withFileTypes: true });

            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                if (item.isDirectory() && isRelevant(item.name)) {
                    await findFiles(fullPath); // Recursive call for directories
                } else if (item.isFile()) {
                    files.push(fullPath);
                }
            }
        };

        await findFiles(projectRoot);
        return files;
    }


    async readFileContents(filePaths) {
        const fileContents = {};
        for (const filePath of filePaths) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                fileContents[filePath] = content;
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
}

export { FileSystem };