// src/lib/UserInteraction/InteractivePromptReviewer.ts
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs'; // Use synchronous fs for writeFileSync and existsSync
import os from 'os';
import chalk from 'chalk';
import { Config } from '../Config'; // Import Config to check the interactive_prompt_review flag

export class InteractivePromptReviewer {
    private config: Config;

    constructor(config: Config) {
        this.config = config;
    }

    /**
     * Allows the user to interactively review and edit a prompt in an external editor.
     * @param initialPrompt The prompt string to be reviewed.
     * @returns The modified prompt string, or null if the user cancels.
     * @throws Error if the editor cannot be opened or other critical issues occur.
     */
    async reviewPrompt(initialPrompt: string): Promise<string | null> {
        if (!this.config.gemini.interactive_prompt_review) {
            console.log(chalk.dim('Interactive prompt review DISABLED. Sending prompt directly...'));
            return initialPrompt; // Return original if feature is disabled
        }

        console.log(chalk.magenta('Interactive prompt review ENABLED. Preparing prompt...'));

        let tempFilePath: string | null = null;
        // Declare editor variables here so they are accessible in the catch block
        let editorCommand = 'subl'; // Default to Sublime Text
        let editorName = 'Sublime Text';
        let editorArgs: string[] = []; // Declare here, assign after tempFilePath is known

        try {
            // 1. Create a temporary file
            const tempDir = os.tmpdir();
            tempFilePath = path.join(tempDir, `kai-prompt-review-${Date.now()}.txt`);
            fs.writeFileSync(tempFilePath, initialPrompt, 'utf8');
            console.log(chalk.grey(`Prompt saved to temporary file: ${tempFilePath}`));

            // Assign editorArgs AFTER tempFilePath is set
            editorArgs = ['--wait', tempFilePath];

            // 2. Open in Editor (Sublime Text is hardcoded for now, can be generalized later)
            // TODO: Enhance editor detection/configuration (similar to UserInterface's editor logic)

            console.log(chalk.yellow(`Opening prompt in ${editorName}. Please review/edit, save, and close the editor to continue...`));
            execSync(`${editorCommand} ${editorArgs.map(arg => `"${arg}"`).join(' ')}`); // Execute command synchronously
            console.log(chalk.yellow(`${editorName} closed. Reading modified prompt...`));

            // 3. Read back the potentially edited content
            const modifiedPrompt = fs.readFileSync(tempFilePath, 'utf8');

            // 4. Ask for confirmation using inquirer
            const { confirmSend } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmSend',
                    message: `Send the reviewed prompt (${modifiedPrompt.length} characters) to the AI model?`,
                    default: true,
                },
            ]);

            // 5. Handle confirmation result
            if (!confirmSend) {
                console.log(chalk.red('User cancelled prompt submission.'));
                return null; // Signal cancellation
            }
            console.log(chalk.green('User confirmed. Proceeding...'));

            return modifiedPrompt; // Return the (potentially modified) prompt

        } catch (error: any) {
            // Handle errors related to editor spawning or file operations
            if ((error as any).code === 'ENOENT') {
                console.error(chalk.red(`\n❌ Error: '${editorCommand}' command not found.`)); // Use editorCommand directly
                console.warn(chalk.yellow(`Please ensure ${editorName} is installed and '${editorCommand}' is in your system's PATH.`));
            } else {
                console.error(chalk.red(`Error opening or waiting for editor (${editorName}):`), error.message);
            }

            const { proceedAnyway } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'proceedAnyway',
                    message: `Editor could not be opened/tracked. Continue with the original prompt?`,
                    default: false,
                },
            ]);
            if (!proceedAnyway) {
                throw new Error('User cancelled prompt submission after editor failure.');
            }
            console.warn(chalk.yellow('Proceeding with the original prompt content.'));
            return initialPrompt; // Fallback to original prompt if user proceeds
        } finally {
            // Cleanup: Delete the temporary file
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                    console.log(chalk.grey(`Temporary prompt file deleted: ${tempFilePath}`));
                } catch (cleanupError) {
                    console.error(chalk.red(`Failed to delete temporary file: ${tempFilePath}`), cleanupError);
                }
            }
        }
    }
}