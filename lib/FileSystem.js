// lib/FileSystem.js
import fs from 'fs/promises';
import path from 'path';

class FileSystem {
    async getAllFiles(dirPath) {
        let files = [];
        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });

            for (const item of items) {
                const fullPath = path.join(dirPath, item.name);
                if (item.isDirectory()) {
                    files = files.concat(await this.getAllFiles(fullPath));
                } else {
                    files.push(fullPath);
                }
            }
        }
        catch(error) {
            console.error("Error in getAllFiles:", error);
            throw error; //Re-throw
        }
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