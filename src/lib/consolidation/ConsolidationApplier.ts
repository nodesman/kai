// File: src/lib/consolidation/ConsolidationApplier.ts
import path from 'path';
import chalk from 'chalk';
import { FileSystem } from '../FileSystem';
import { FinalFileStates } from './types';

interface ApplyOperationResult {
    status: 'success' | 'failed' | 'skipped';
    message: string;
    error?: Error; // Include error object if failed
}

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

        const results: ApplyOperationResult[] = [];

        for (const relativePath in finalStates) {
            const result = await this._applyOperationToFile(
                relativePath,
                finalStates[relativePath],
                projectRoot
            );
            results.push(result);
        }

        // Aggregate results and log summary
        const { success, failed, skipped, summary } = this._aggregateAndLogResults(results);

        // Return the result, let the caller handle logging to conversation file and throwing based on failures.
        return { success, failed, skipped, summary };
    }

    /**
     * Applies a single file operation (write or delete) based on the proposed state.
     * @param relativePath The relative path of the file.
     * @param contentOrAction The proposed content or 'DELETE_CONFIRMED'.
     * @param projectRoot The project root directory.
     * @returns An object summarizing the result of the operation.
     */
    private async _applyOperationToFile(
        relativePath: string,
        contentOrAction: string | 'DELETE_CONFIRMED',
        projectRoot: string
    ): Promise<ApplyOperationResult> {
        // Normalize path separators and remove leading/trailing slashes for consistency
        const normalizedPath = path.normalize(relativePath).replace(/^[\\\/]+|[\\\/]+$/g, '');
        const absolutePath = path.resolve(projectRoot, normalizedPath);
        let logMsg = '';
        let status: ApplyOperationResult['status'] = 'success'; // Assume success initially

        try {
            if (contentOrAction === 'DELETE_CONFIRMED') {
                // Attempt to delete the file
                status = await this._deleteFile(absolutePath, normalizedPath);
                logMsg = status === 'skipped'
                    ? `Skipped delete (already gone): ${normalizedPath}`
                    : `Deleted: ${normalizedPath}`;
            } else {
                // Attempt to write the file
                const contentToWrite = typeof contentOrAction === 'string' ? contentOrAction : '';
                await this._writeFile(absolutePath, contentToWrite);
                logMsg = `Written: ${normalizedPath} (${contentToWrite.length} characters)`;
                status = 'success';
            }

            // Log based on status
            if (status === 'success') console.log(chalk.green(`    ${logMsg}`));
            else if (status === 'skipped') console.warn(chalk.yellow(`    ${logMsg}`));

            return { status, message: logMsg };

        } catch (error) {
            const actionType = contentOrAction === 'DELETE_CONFIRMED' ? 'delete' : 'write';
            const errorMsg = `Failed ${actionType} operation for ${normalizedPath}: ${(error as Error).message}`;
            console.error(chalk.red(`    ${errorMsg}`), error); // Log the full error object too
            return { status: 'failed', message: errorMsg, error: error as Error };
        }
    }

    /** Handles file deletion with existence check. */
    private async _deleteFile(absolutePath: string, normalizedPathForLog: string): Promise<'success' | 'skipped'> {
         try {
            await this.fs.access(absolutePath); // Check if it exists before deleting
            await this.fs.deleteFile(absolutePath);
            return 'success';
        } catch (accessError) {
            if ((accessError as NodeJS.ErrnoException).code === 'ENOENT') {
                return 'skipped'; // File already gone
            } else {
                // Rethrow unexpected access errors during delete check
                console.error(`Unexpected error checking existence before deleting ${normalizedPathForLog}:`, accessError);
                throw accessError;
            }
        }
    }

    /** Handles file writing, ensuring the directory exists. */
    private async _writeFile(absolutePath: string, content: string): Promise<void> {
        await this.fs.ensureDirExists(path.dirname(absolutePath));
        await this.fs.writeFile(absolutePath, content);
    }

    /** Aggregates results from individual operations and logs a summary. */
    private _aggregateAndLogResults(results: ApplyOperationResult[]): { success: number; failed: number; skipped: number; summary: string[] } {
        let success = 0, failed = 0, skipped = 0;
        const summary: string[] = results.map(r => r.message); // Collect all messages

        results.forEach(result => {
            if (result.status === 'success') success++;
            else if (result.status === 'failed') failed++;
            else if (result.status === 'skipped') skipped++;
        });

        console.log(chalk.blue("\n  --- File Application Summary ---"));
        summary.forEach(l => console.log(
            l.startsWith("Failed") ? chalk.red(`  - ${l}`)
            : l.startsWith("Skipped") ? chalk.yellow(`  - ${l}`)
            : chalk.green(`  - ${l}`)
        ));
        console.log(chalk.blue(`  ---------------------------------`));
        console.log(chalk.blue(`  Applied: ${success}, Skipped/No-op: ${skipped}, Failed: ${failed}.`));

        return { success, failed, skipped, summary };
    }
}