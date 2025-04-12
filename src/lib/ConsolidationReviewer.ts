// File: src/lib/ConsolidationReviewer.ts
import path from 'path';
import chalk from 'chalk';
import * as Diff from 'diff';
import inquirer from 'inquirer';
import { FileSystem } from './FileSystem';
import ReviewUIManager, { ReviewDataItem, ReviewAction } from './ReviewUIManager'; // Adjust path if needed
import { FinalFileStates } from './ConsolidationService'; // Import the type - Adjust path if needed

export class ConsolidationReviewer {
    private fs: FileSystem;
    // We might not need the full Config here, depends on future needs.

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
        if (reviewData.length > 0) {
            console.log(chalk.green(`  Review preparation complete: ${reviewData.length} files with changes ready for review.`));
        }
        // Present for review (TUI or fallback)
        return await this._presentChangesForReviewTUI(reviewData);
    }


    // --- Private Methods (Moved from ConsolidationService) ---

    /**
     * Generates diffs and prepares data suitable for the ReviewUIManager.
     * @param finalStates The proposed final content or deletion status for each file.
     * @param projectRoot The root directory of the project.
     * @returns An array of ReviewDataItem objects containing diffs for meaningful changes.
     */
    private async _prepareReviewData(finalStates: FinalFileStates, projectRoot: string): Promise<ReviewDataItem[]> {
        const reviewData: ReviewDataItem[] = [];
        for (const relativePath in finalStates) {
            const proposed = finalStates[relativePath];
            const absolutePath = path.resolve(projectRoot, relativePath);
            let current: string | null = null;
            let action: ReviewAction = 'MODIFY';

            try {
                current = await this.fs.readFile(absolutePath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.error(chalk.red(`Error reading current state of ${relativePath}:`), error);
                    // Decide if we should stop or just skip this file
                    throw error; // Stop for unexpected errors
                }
                // If ENOENT, current remains null, indicating creation
            }

            let diffStr = '';
            let isMeaningful = false;

            if (proposed === 'DELETE_CONFIRMED') {
                action = 'DELETE';
                if (current !== null) {
                    // Generate diff from current state to empty state
                    diffStr = Diff.createPatch(relativePath, current, '', '', '', { context: 5 });
                    isMeaningful = true; // Deleting an existing file is meaningful
                } else {
                    // File was marked for delete but doesn't exist, skip review
                    console.log(chalk.gray(`  Skipping review for DELETE ${relativePath} - file already gone.`));
                    continue; // Move to the next file
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
                        // Check if the diff introduces actual changes beyond headers/whitespace
                        // A simple check: does the diff contain '+' or '-' lines (excluding file headers)?
                        isMeaningful = diffStr.split('\n').slice(2).some(l => l.startsWith('+') || l.startsWith('-'));
                    } else {
                        // Current and proposed content are identical
                        isMeaningful = false;
                    }
                }
            }

            // Add to review data only if the change is meaningful
            if (isMeaningful) {
                reviewData.push({ filePath: relativePath, action, diff: diffStr });
            } else {
                console.log(chalk.gray(`  Skipping review for ${relativePath} - no effective changes detected.`));
            }
        }
        return reviewData;
    }

    /**
     * Presents the generated review data (diffs) to the user via TUI or fallback CLI prompt.
     * @param reviewData An array of ReviewDataItem objects.
     * @returns A promise resolving to `true` if the user approves, `false` otherwise.
     */
    private async _presentChangesForReviewTUI(reviewData: ReviewDataItem[]): Promise<boolean> {
        if (reviewData.length === 0) {
            console.log(chalk.yellow("No meaningful changes detected to review."));
            // If there are no *meaningful* changes, should we still proceed?
            // Let's assume for now if reviewData is empty, we don't apply anything.
            return false;
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