// lib/UserInterface.js
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises'; // Use fs.promises for async operations
import { FileSystem } from './FileSystem.js';
import { fileURLToPath } from 'url'; // Import for __dirname
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class UserInterface {
    constructor() {
        this.fs = new FileSystem();
    }

    async getPromptFromSublime() {
        const tempFilePath = path.join(__dirname, '../temp_prompt.txt'); // Correct relative path
        const sublProcess = spawn('subl', ['-w', tempFilePath], { stdio: 'inherit' });

        return new Promise((resolve, reject) => {
            sublProcess.on('close', async (code) => {
                if (code === 0) {
                    try {
                        const prompt = await fs.readFile(tempFilePath, 'utf-8');
                        await this.fs.deleteFile(tempFilePath); // Use async deleteFile
                        resolve(prompt);
                    } catch (error) {
                        reject(error);
                    }
                } else {
                    reject(new Error(`Sublime Text exited with code ${code}`));
                }
            });

            sublProcess.on('error', (error) => {
                reject(error);
            });
        });
    }


    async getUserInteraction() {
        try {
            const { mode } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Select a mode:',
                    choices: ['Ask a Question', 'Request Code Changes'],
                },
            ]);

            let userPrompt = await this.getPromptFromSublime();

            if (!userPrompt.trim()) {
                console.log(
                    mode === 'Ask a Question'
                        ? 'No question provided. Exiting.'
                        : 'No change request provided. Exiting.'
                );
                return null;
            }

            return { userPrompt, mode };
        } catch (error) {
            console.error('Error in getUserInteraction:', error);
            throw error; // Re-throw to handle it in the main function
        }
    }
}

export { UserInterface };