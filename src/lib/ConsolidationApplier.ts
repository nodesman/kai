// File: src/lib/ConsolidationApplier.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from './FileSystem';
import { FinalFileStates } from './ConsolidationService'; // Import the type definition

export class ConsolidationApplier {
    private fs: FileSystem;

    constructor(fileSystem: FileSystem) {
        this.fs = fileSystem;
    }

    /**
     * Applies the consolidated changes (writes/deletes files) to the filesystem.
     * Logs the progress and returns a summary of operations.
     * @param finalStates The final desired state of each file.
     * @param projectRoot The root directory of the project.
     * @returns A promise resolving to an object containing counts and a summary array.
     * @throws An error if any file operation fails catastrophically (re-throws from fs).
     */
    async apply(
        finalStates: FinalFileStates,
        projectRoot: string
    ): Promise<{ success: number; failed: number; skipped: number; summary: string[] }> {
        console.log(chalk.blue("  Applying consolidated changes to filesystem..."));

        let success = 0, failed = 0, skipped = 0;
        const summary: string[] = [];

        for (const relativePath in finalStates) {
            // Normalize path separators and remove leading/trailing slashes for consistency
            const normalizedPath = path.normalize(relativePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
            const absolutePath = path.resolve(projectRoot, normalizedPath);
            const contentOrAction = finalStates[relativePath]; // Get the original state from the map

            try {
                if (contentOrAction === 'DELETE_CONFIRMED') {
                    try {
                        await this.fs.access(absolutePath); // Check if it exists before deleting
                        await this.fs.deleteFile(absolutePath);
                        const logMsg = `Deleted: ${normalizedPath}`;
                        console.log(chalk.red(`    ${logMsg}`));
                        summary.push(logMsg);
                        success++;
                    } catch (accessError) {
                        if ((accessError as NodeJS.ErrnoException).code === 'ENOENT') {
                            const logMsg = `Skipped delete (already gone): ${normalizedPath}`;
                            console.warn(chalk.yellow(`    ${logMsg}`));
                            summary.push(logMsg);
                            skipped++;
                        } else {
                            // Rethrow unexpected access errors during delete check
                            throw accessError;
                        }
                    }
                } else {
                    // Ensure contentOrAction is a string for writeFile
                    const contentToWrite = typeof contentOrAction === 'string' ? contentOrAction : '';
                    await this.fs.ensureDirExists(path.dirname(absolutePath));
                    await this.fs.writeFile(absolutePath, contentToWrite);
                    const logMsg = `Written: ${normalizedPath} (Length: ${contentToWrite.length})`;
                    console.log(chalk.green(`    ${logMsg}`));
                    summary.push(logMsg);
                    success++;
                }
            } catch (error) {
                const actionType = contentOrAction === 'DELETE_CONFIRMED' ? 'delete' : 'write';
                const errorMsg = `Failed ${actionType} operation for ${normalizedPath}: ${(error as Error).message}`;
                console.error(chalk.red(`    ${errorMsg}`), error); // Log the full error object too
                summary.push(errorMsg);
                failed++;
                // Decide if one failure should stop the whole process.
                // Currently, it continues processing other files but marks this one as failed.
                // We will check the 'failed' count later.
            }
        }

        console.log(chalk.blue("\n  --- File Application Summary ---"));
        summary.forEach(l => console.log(l.startsWith("Failed") ? chalk.red(`  - ${l}`) : l.startsWith("Skipped") ? chalk.yellow(`  - ${l}`) : chalk.green(`  - ${l}`)));
        console.log(chalk.blue(`  ---------------------------------`));
        console.log(chalk.blue(`  Applied: ${success}, Skipped/No-op: ${skipped}, Failed: ${failed}.`));

        // Return the result, let the caller handle logging to conversation file and throwing based on failures.
        return { success, failed, skipped, summary };
    }
}