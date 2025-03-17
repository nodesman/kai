// lib/UserInterface.ts
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises'; // Use fs.promises for async operations
import { FileSystem } from './FileSystem';

class UserInterface {
    fs: FileSystem; // Declare the 'fs' property

    constructor() {
        this.fs = new FileSystem();
    }

    async getPromptFromSublime(): Promise<string> {
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


    async getUserInteraction(): Promise<{ userPrompt: string; mode: string } | null> {
        try {
            const { mode } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Select a mode:',
                    choices: ['Ask a Question', 'Request Code Changes'],
                },
            ]);

            let userPrompt: string = ""; // Initialize userPrompt

            if (mode === 'Ask a Question') {
                userPrompt = await this.getPromptFromSublime();
            }


            if (mode === 'Ask a Question' && !userPrompt.trim()) {
                console.log('No question provided. Exiting.');
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