import { FileSystem} from "../FileSystem";

class RelevantFileFinder {
    private fs: FileSystem;

    constructor(fs: FileSystem) {
        this.fs = fs;
    }

    async findRelevantFiles(filePaths: string[], keywords: string[]): Promise<string[]> {
        const relevantFiles: Set<string> = new Set();
        for (const filePath of filePaths) {
            const fileContent = await this.fs.readFile(filePath);
            if (!fileContent) continue;

            if (this.isFileRelevant(fileContent, keywords)) {
                relevantFiles.add(filePath);
            }
        }
        return Array.from(relevantFiles);
    }

    private isFileRelevant(fileContent: string, keywords: string[]): boolean {
        const fileContentLower = fileContent.toLowerCase();
        return keywords.some(keyword => fileContentLower.includes(keyword));
    }
}
export default RelevantFileFinder;