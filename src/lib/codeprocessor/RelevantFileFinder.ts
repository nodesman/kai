// src/lib/codeprocessor/RelevantFileFinder.ts

import { FileSystem } from "../FileSystem";
import path from 'path';
import fs from 'fs/promises';
import ignore, { Ignore } from 'ignore';
import { isBinaryFile } from 'isbinaryfile';

class RelevantFileFinder {
    private fs: FileSystem;
    private ignoreFilter: Ignore;

    constructor(fs: FileSystem) {
        this.fs = fs;
        this.ignoreFilter = ignore();
    }

    async findRelevantFiles(projectRoot: string): Promise<string[]> {
        await this.loadIgnoreFile(projectRoot); // Load .kaiignore or .gitignore

        const allFiles = await this.fs.getProjectFiles(projectRoot);
        const relevantFiles = [];
        for (const file of allFiles) {
            if (!(await this.isIgnored(file, projectRoot))) {
                relevantFiles.push(file);
            }
        }
        return relevantFiles;
    }

    private async isIgnored(filePath: string, projectRoot: string): Promise<boolean> {
        const relativePath = path.relative(projectRoot, filePath);

        // Check against ignore patterns
        if (this.ignoreFilter.ignores(relativePath)) {
            return true;
        }

        // Check if the file is binary
        try {
            if (await isBinaryFile(filePath)) {
                return true;
            }
        } catch (error) {
            console.error(`Error checking if ${filePath} is binary:`, error);
            // Assume irrelevant on error
            return true;
        }

        return false;
    }

    private async loadIgnoreFile(projectRoot: string) {
        const kaiignorePath = path.join(projectRoot, '.kaiignore');
        const gitignorePath = path.join(projectRoot, '.gitignore');

        try {
            // Try loading .kaiignore first
            const kaiignoreContent = await fs.readFile(kaiignorePath, 'utf8');
            this.ignoreFilter.add(kaiignoreContent);
            console.log(".kaiignore file loaded");
        } catch (kaiignoreError: any) {
            if (kaiignoreError.code === 'ENOENT') {
                // .kaiignore not found, try .gitignore
                try {
                    const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
                    this.ignoreFilter.add(gitignoreContent);
                    console.log(".gitignore file loaded");
                } catch (gitignoreError: any) {
                    if (gitignoreError.code !== 'ENOENT') {
                        // Log error if it's NOT a "file not found" error
                        console.error(`Error reading .gitignore file: ${gitignoreError}`);
                    } else {
                        console.log("Neither .kaiignore nor .gitignore found");
                    }
                }
            } else {
                // Log error if it's NOT a "file not found" error with .kaiignore
                console.error(`Error reading .kaiignore file: ${kaiignoreError}`);
            }
        }
    }
}

export default RelevantFileFinder;