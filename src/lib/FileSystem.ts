import fs from 'fs/promises';
import path from 'path';
import ignore from 'ignore';

class FileSystem {
    async getProjectFiles(projectRoot: string): Promise<string[]> {
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
            'node_modules',
            '.git',
            '.idea',
            '.vscode',
            'dist',
            'build',
            'coverage',
            '.*.swp',
            '~'
        ];

        ig.add(ignorePatterns);


        const isRelevant = (filePath: string, isDirectory = false): boolean => {
            const relativePath = path.relative(projectRoot, filePath);
            if (isDirectory) {
                for (const pattern of ignorePatterns) {
                    if (relativePath === pattern || relativePath.startsWith(pattern + path.sep)) {
                        return false;
                    }
                }
            }

            return !ig.ignores(relativePath);
        };

        const files: string[] = [];

        const findFiles = async (dir: string): Promise<void> => {
            const items = await fs.readdir(dir, { withFileTypes: true });

            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                const relativePath = path.relative(projectRoot, fullPath);

                if (item.isDirectory()) {
                    if (!isRelevant(fullPath, true)) {
                        console.log(`Skipping directory (gitignore - full exclusion): ${relativePath}`);
                        continue;
                    }
                    await findFiles(fullPath);

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



    async readFileContents(filePaths: string[]): Promise<{ [filePath: string]: string | null }> {
        const fileContents: { [filePath: string]: string | null } = {};
        for (const filePath of filePaths) {
            try {
                if (await this.isTextFile(filePath)) {
                    const content = await this.readFile(filePath);
                    fileContents[filePath] = content; // No longer need to check if content exists.
                } else {
                    console.log(`Skipping binary file: ${filePath}`);
                    fileContents[filePath] = null;

                }
            } catch (error: any) {
                console.error(`Error reading file ${filePath}: ${error.message}`);
                fileContents[filePath] = null; // Handle the case where reading fails
            }
        }
        return fileContents;
    }


    async writeFile(filePath: string, content: string): Promise<void> {
        try {
            const directory = path.dirname(filePath);
            try {
                await fs.access(directory);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    await fs.mkdir(directory, { recursive: true });
                } else {
                    throw error;
                }
            }
            await fs.writeFile(filePath, content, 'utf-8');

        } catch (error: any) {
            console.error(`Error writing file ${filePath}: ${error}`);
            throw error;
        }
    }

    async deleteFile(filePath: string): Promise<void> {
        if (filePath) {
            try {
                const stats = await fs.stat(filePath).catch(() => null);
                if (stats && stats.isFile()) {
                    await fs.unlink(filePath);
                    console.log(`Deleted file: ${filePath}`);
                } else {
                    console.log(`File does not exist: ${filePath}`);
                }
            } catch (error: any) {
                console.error(`Error deleting file ${filePath}: ${error}`);
                throw error;
            }
        }
    }

    async readFile(filePath: string): Promise<string | null> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        }
        catch(error: any) {
            console.error(`Error reading file in readFile: ${filePath} : ${error}`);
            return null;
        }
    }
    async isTextFile(filePath: string): Promise<boolean> {
        try {
            const buffer = await fs.readFile(filePath);
            const textExtensions = ['.txt', '.js', '.ts', '.jsx', '.py', '.java', '.cpp', '.h', '.html', '.css', '.json', '.xml', '.md', '.yaml', '.yml', '.sh', '.config', '.log', '.csv', '.tsv'];
            const ext = path.extname(filePath).toLowerCase();

            if (textExtensions.includes(ext)) {
                return true;
            }

            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] === 0) {
                    return false;
                }
            }
            return true;


        } catch (error: any) {
            console.error(`Error checking if file is text: ${filePath}`, error);
            return false;
        }
    }
}

export { FileSystem };