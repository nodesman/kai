// lib/CodeProcessor.js
import path from 'path';
import { FileSystem } from './FileSystem.js';
import { AIClient } from './AIClient.js';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { execSync } from 'child_process';
import inquirer from 'inquirer';

class CodeProcessor {
    constructor(config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(this.config);
        this.projectRoot = process.cwd(); // Use current working directory
        this.srcDir = path.join(this.projectRoot, 'src'); // Assuming 'src' exists
    }

    countTokens(text) {
        return gpt3Encode(text).length;
    }

    async buildPreloadPrompt(userPrompt) {
        const keywords = this.extractKeywords(userPrompt);
        const filePaths = await this.fs.getAllFiles(this.srcDir); // Now async
        const relevantFilePaths = await this.findRelevantFiles(filePaths, keywords);
        const fileContents = await this.fs.readFileContents(relevantFilePaths); // Now async

        const messages = [];
        let currentChunk = "";
        let currentChunkTokens = 0;

        for (const filePath of relevantFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            const content = fileContents[filePath];
            if (!content) continue;

            const fileHeader = `File: ${relativePath}\n\`\`\`\n`;
            const fileFooter = "\n```\n";
            const fileContent = fileHeader + content + fileFooter;
            const fileTokens = this.countTokens(fileContent);

            if (currentChunkTokens + fileTokens > this.config.get('gemini').max_context_length) {
                messages.push({ role: "user", parts: [{ text: currentChunk }] });
                messages.push({ role: "model", parts: [{ text: "Sure, I've loaded that code." }] });
                currentChunk = "";
                currentChunkTokens = 0;
            }

            currentChunk += fileContent;
            currentChunkTokens += fileTokens;
        }

        if (currentChunk) {
            messages.push({ role: "user", parts: [{ text: currentChunk }] });
            messages.push({ role: "model", parts: [{ text: "Okay, I've loaded the remaining files." }] }); //Consistent
        }
        return messages;
    }

    extractKeywords(prompt) {
        // Basic keyword extraction (can be improved with NLP techniques)
        const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'is', 'are', 'of', 'and', 'it', 'this', 'that']); //Common words
        const words = prompt.toLowerCase().split(/\s+/); //split by whitespace
        const keywords = words.filter(word => !stopWords.has(word) && word.length > 3); // Remove stop words and short words
        return [...new Set(keywords)]; // Remove duplicates
    }

    async findRelevantFiles(filePaths, keywords) {
        const relevantFiles = [];
        for (const filePath of filePaths) {
            const content = await this.fs.readFile(filePath, 'utf-8'); //Now async
            if (!content) continue;
            for (const keyword of keywords) {
                if (content.toLowerCase().includes(keyword)) {
                    relevantFiles.push(filePath);
                    break; // Move to the next file if a keyword is found
                }
            }
        }
        return relevantFiles;
    }
    async processCodeChanges(userPrompt) {
        const preloadMessages = await this.buildPreloadPrompt(userPrompt);
        const { diff: allDiffs, filesImpacted } = await this.aiClient.getDiffFromAI(preloadMessages, userPrompt); //pass down userprompt

        if (filesImpacted.length === 0) {
            if (allDiffs.trim().length > 0) {
                console.log("No files were impacted (but AI responded):");
                console.log(allDiffs); // Log the AI's response
            }
            return null;
        }

        console.log("\nFiles Impacted:");
        filesImpacted.forEach(file => console.log(`- ${file}`));

        const diffFilePath = await this.createAndShowDiff(allDiffs);
        return { diffFilePath, userPrompt }; // Return necessary info
    }

    async createAndShowDiff(diffContent) {
        const diffFilePath = path.join(this.projectRoot, 'changes.diff');
        try {
            await this.fs.writeFile(diffFilePath, diffContent); // Now async
            console.log("\nShowing diff (using git diff --no-index):\n");

            const gitDiffProcess = spawn('git', ['diff', '--no-index', '--color', '.', diffFilePath], {
                stdio: 'inherit',
                cwd: this.projectRoot
            });

            return new Promise((resolve, reject) => {
                gitDiffProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(diffFilePath);
                    } else {
                        reject(new Error(`git diff exited with code ${code}`));
                    }
                });
                gitDiffProcess.on('error', reject);
            });

        } catch (error) {
            console.error("Error creating or showing diff:", error);
            await this.fs.deleteFile(diffFilePath); // Clean up on error
            return null; // Return null to indicate failure
        }
    }

    async applyDiffWithStaging(diffFilePath) {
        if (!diffFilePath) {
            console.log("No diff file to apply.");
            return false;
        }

        try {
            execSync(`git apply "${diffFilePath}"`, { stdio: 'inherit', cwd: this.projectRoot });
            console.log("Changes applied and staged.");
            return true;
        } catch (error) {
            console.error("Error applying diff:", error);
            console.log("\nDiff file contents for debugging:");
            const diffContents = await this.fs.readFile(diffFilePath, 'utf-8');
            console.log(diffContents);

            // Offer recovery options to the user:
            const { resolution } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'resolution',
                    message: 'Failed to apply diff. What would you like to do?',
                    choices: [
                        'Discard changes',
                        'Manually resolve conflicts (advanced)',
                        'Retry with a revised prompt' // This requires more work in main()
                    ]
                }
            ]);

            if (resolution === 'Discard changes') {
                await this.fs.deleteFile(diffFilePath);
                return false;
            } else if (resolution === 'Manually resolve conflicts') {
                console.log("Please manually resolve conflicts in the affected files.");
                console.log("After resolving, you can stage and commit the changes manually.");
                await this.fs.deleteFile(diffFilePath);
                return false; // Changes are NOT staged automatically
            } else if (resolution === 'Retry with a revised prompt') {
                await this.fs.deleteFile(diffFilePath);
                return false;
                // The main loop needs to handle this and re-prompt
            }
        }
    }
    async commitChanges(userPrompt, diffFilePath) {
        try {
            execSync(`git commit -m "${userPrompt}"`, {
                stdio: 'inherit',
                cwd: this.projectRoot,
            });
            console.log('Changes committed.');
        } catch (error) {
            console.error('Error during git commit:', error);
            console.log(
                'Changes might be staged but not committed. Please check manually.'
            );
        } finally {
            await this.fs.deleteFile(diffFilePath);
        }
    }

    async askQuestion(userPrompt) {
        const preloadMessages = await this.buildPreloadPrompt(userPrompt);
        const questionMessage = { role: "user", parts: [{ text: userPrompt }] };
        const finalMessages = [...preloadMessages, questionMessage];

        const response = await this.aiClient.getResponseFromAI(finalMessages); // Pass the entire array
        console.log(response);
    }
}

export { CodeProcessor };