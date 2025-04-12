// File: src/lib/consolidation/ConsolidationReviewer.ts
import path from 'path';
import chalk from 'chalk';
import * as Diff from 'diff';
import inquirer from 'inquirer';
import { FileSystem } from '../FileSystem'; // Path relative to src/lib/
import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager'; // Path relative to src/lib/consolidation/
import { FinalFileStates } from './types'; // Path relative to src/lib/consolidation/

export class ConsolidationReviewer {
    private fs: FileSystem;

    constructor(fileSystem: FileSystem) {
        this.fs = fileSystem;
    }

    /**
     * Takes the final proposed file states, prepares review data (diffs),
     * presents them to the user via TUI (or fallback), and returns the user's decision.
     * @param finalStates The proposed final content or deletion status for each file.
     * @param projectRoot The root directory of the project.
     * @returns A promise resolving to `true` if the user approves changes, `false` otherwise.
     */
    async reviewChanges(finalStates: FinalFileStates, projectRoot: string): Promise<boolean> {
        console.log(chalk.cyan("\n  Step C: Preparing changes for review..."));

        const reviewData = await this._prepareReviewData(finalStates, projectRoot);

        if (reviewData.length === 0) {
            console.log(chalk.yellow("No meaningful changes identified to review. Proceeding without review."));
            // If no *meaningful* changes require review, should we still apply potential whitespace-only changes?
            // Current assumption: Yes, the applier will handle writing identical content if needed.
            // But we bypass the TUI/prompt if nothing is *meaningful* for review.
            // Let's return true to allow the apply step to proceed.
            return true; // Indicate to proceed with apply step, even if review is skipped
        } else {
             console.log(chalk.green(`  Review preparation complete: ${reviewData.length} files with changes ready for review.`));
            // Present for review (TUI or fallback)
            return await this._presentChangesForReviewTUI(reviewData);
        }
    }

    // --- Private Methods ---

    /**
     * Generates diffs and prepares data suitable for the ReviewUIManager.
     * @param finalStates The proposed final content or deletion status for each file.
     * @param projectRoot The root directory of the project.
     * @returns An array of ReviewDataItem objects containing diffs for meaningful changes.
     */
    private async _prepareReviewData(finalStates: FinalFileStates, projectRoot: string): Promise<ReviewDataItem[]> {
        const reviewDataItems: ReviewDataItem[] = [];
        const filePaths = Object.keys(finalStates);

        // Process files potentially in parallel for reading current state
        const processingPromises = filePaths.map(relativePath =>
            this._processSingleFileForReview(relativePath, finalStates[relativePath], projectRoot)
        );

        const results = await Promise.all(processingPromises);

        // Filter out null results (files skipped or with no meaningful change)
        for (const result of results) {
            if (result) {
                reviewDataItems.push(result);
            }
        }

        return reviewDataItems;
    }

    /**
     * Processes a single file to determine its review action, generate a diff, and check for meaningful changes.
     * @param relativePath The relative path of the file.
     * @param proposed The proposed final content or 'DELETE_CONFIRMED'.
     * @param projectRoot The project root directory.
     * @returns A ReviewDataItem if the change is meaningful, otherwise null.
     */
    private async _processSingleFileForReview(
        relativePath: string,
        proposed: string | 'DELETE_CONFIRMED',
        projectRoot: string
    ): Promise<ReviewDataItem | null> {
        const absolutePath = path.resolve(projectRoot, relativePath);
        let current: string | null = null;
        let action: ReviewAction;
        let diffStr: string = '';
        let isMeaningful: boolean = false;

        try {
            current = await this.fs.readFile(absolutePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error(chalk.red(`  Error reading current state of ${relativePath}:`), error);
                // Decide if we should stop or just skip this file
                throw error; // Stop for unexpected errors
            }
            // If ENOENT, current remains null, indicating creation or already deleted
        }

        if (proposed === 'DELETE_CONFIRMED') {
            action = 'DELETE';
            if (current !== null) {
                // Generate diff from current state to empty state
                diffStr = Diff.createPatch(relativePath, current, '', '', '', { context: 5 });
                isMeaningful = true; // Deleting an existing file is meaningful
            } else {
                // File was marked for delete but doesn't exist, skip review
                console.log(chalk.gray(`  Skipping review for DELETE ${relativePath} - file already gone.`));
                return null; // Skip this file
            }
        } else {
            // Ensure proposed is a string (handle potential type issues)
            const proposedContent = typeof proposed === 'string' ? proposed : '';

            if (current === null) {
                action = 'CREATE';
                // Generate diff from empty state to proposed content
                diffStr = Diff.createPatch(relativePath, '', proposedContent, '', '', { context: 5 });
                // Creation is meaningful only if content is not just whitespace
                isMeaningful = proposedContent.trim().length > 0;
            } else {
                action = 'MODIFY';
                if (current !== proposedContent) {
                    // Generate diff between current and proposed content
                    diffStr = Diff.createPatch(relativePath, current, proposedContent, '', '', { context: 5 });
                    isMeaningful = this._isDiffMeaningful(diffStr);
                } else {
                    // Current and proposed content are identical
                    isMeaningful = false;
                }
            }
        }

        // Return data only if the change is meaningful
        if (isMeaningful) {
            return { filePath: relativePath, action, diff: diffStr };
        } else {
            console.log(chalk.gray(`  Skipping review for ${relativePath} - no effective changes detected.`));
            return null;
        }
    }

     /**
      * Checks if a generated diff string represents actual code changes beyond headers/whitespace.
      * @param diffStr The diff string generated by Diff.createPatch.
      * @returns True if the diff contains meaningful changes, false otherwise.
      */
     private _isDiffMeaningful(diffStr: string): boolean {
         // A simple check: does the diff contain '+' or '-' lines (excluding file headers)?
         // Slice(2) skips the '---' and '+++' header lines.
         return diffStr.split('\n').slice(2).some(l => l.startsWith('+') || l.startsWith('-'));
     }


    /**
     * Presents the generated review data (diffs) to the user via TUI or fallback CLI prompt.
     * @param reviewData An array of ReviewDataItem objects.
     * @returns A promise resolving to `true` if the user approves, `false` otherwise.
     */
    private async _presentChangesForReviewTUI(reviewData: ReviewDataItem[]): Promise<boolean> {
        // This check is now technically redundant due to the logic in reviewChanges,
        // but keep it as a safeguard.
        if (reviewData.length === 0) {
            console.log(chalk.yellow("No meaningful changes detected to review (TUI presentation)."));
            return false; // Should not proceed if called with empty data
        }

        console.log(chalk.yellow("\nInitializing Review UI..."));
        try {
            // Instantiate and run the TUI
            const reviewUI = new ReviewUIManager(reviewData);
            const userDecision = await reviewUI.run(); // This promise resolves with true (Apply) or false (Reject)
            return userDecision;

        } catch (tuiError) {
            // Fallback to simple CLI confirmation if TUI fails
            console.error(chalk.red("Error displaying Review TUI:"), tuiError);
            console.log(chalk.yellow("Falling back to simple CLI confirmation."));

            // Summarize changes for the fallback prompt
            const changeSummary = reviewData.map(item => `  ${item.action.padEnd(6)}: ${item.filePath}`).join('\n');
            console.log(chalk.cyan("\nProposed changes:"));
            console.log(changeSummary);

            const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
                type: 'confirm',
                name: 'confirm',
                message: `Review UI failed. Apply the ${reviewData.length} file change(s) listed above?`,
                default: false // Default to not applying changes for safety
            }]);
            return confirm;
        }
    }
}