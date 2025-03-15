// lib/CodeProcessor.js
import path from 'path';
import { FileSystem } from './FileSystem.js';
import { AIClient } from './AIClient.js';
import { encode as gpt3Encode } from 'gpt-3-encoder';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
// No need for __dirname in this file anymore
//import { fileURLToPath } from 'url';
//import { dirname } from 'path';
//import fs from 'fs';  // Only needed for the src check, now removed.


class CodeProcessor {
    constructor(config) {
        this.config = config;
        this.fs = new FileSystem();
        this.aiClient = new AIClient(this.config);
        this.projectRoot = process.cwd(); // Use the CURRENT WORKING DIRECTORY
        // No srcDir needed anymore!
        this.lastUserPrompt = null; // Initialize lastUserPrompt

    }

    countTokens(text) {
        return gpt3Encode(text).length;
    }

    async buildPreloadPrompt(userPrompt) {
        const keywords = this.extractKeywords(userPrompt);
        const filePaths = await this.fs.getProjectFiles(this.projectRoot);
        const relevantFilePaths = await this.findRelevantFiles(filePaths, keywords);
        const fileContents = await this.fs.readFileContents(relevantFilePaths);

        const messages = [];
        let currentChunk = "";
        let currentChunkTokens = 0;

        for (const filePath of relevantFilePaths) {
            const relativePath = path.relative(this.projectRoot, filePath);
            let content = fileContents[filePath];  // Get the content
            if (!content) continue;

            // --- Whitespace Optimization ---
            content = this.optimizeWhitespace(content); // Apply optimization

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
            messages.push({ role: "model", parts: [{ text: "Okay, I've loaded the remaining files." }] });
        }
        return messages;
    }


    optimizeWhitespace(code) {
        // 1. Remove trailing whitespace from each line:
        code = code.replace(/[ \t]+$/gm, '');

        // 2. Reduce multiple blank lines to a single blank line:
        code = code.replace(/\n\s*\n/g, '\n\n');

        // 3. Trim leading/trailing whitespace from the entire string:
        code = code.trim();

        return code;
    }

    extractKeywords(prompt) {
        const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'is', 'are', 'of', 'and', 'it', 'this', 'that', "i", "my", "you", "your"]); // Add common pronouns
        const words = prompt.toLowerCase().split(/\s+/);
        const keywords = words.filter(word => !stopWords.has(word) && word.length > 2); // Include slightly shorter words
        return [...new Set(keywords)]; // Remove duplicates
    }

    async findRelevantFiles(filePaths, keywords) {
        const relevantFiles = [];
        for (const filePath of filePaths) {
            const content = await this.fs.readFile(filePath, 'utf-8');
            if (!content) continue;
            // Use a more robust check for keywords
            const fileContentLower = content.toLowerCase();
            if (keywords.some(keyword => fileContentLower.includes(keyword))) {
                relevantFiles.push(filePath);
            }
        }
        return relevantFiles;
    }

    async processCodeChanges(userPrompt) {
        this.lastUserPrompt = userPrompt; // Store for conflict resolution
        const preloadMessages = await this.buildPreloadPrompt(userPrompt);
        const { diff: allDiffs, filesImpacted } = await this.aiClient.getDiffFromAI(preloadMessages, userPrompt);

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
        return { diffFilePath, userPrompt };
    }

    async createAndShowDiff(diffContent) {
        const diffFilePath = path.join(this.projectRoot, 'changes.diff'); // Save in the *current* project root
        try {
            await this.fs.writeFile(diffFilePath, diffContent);
            console.log("\nShowing diff (using git diff --no-index):\n");

            // No need to specify cwd here, as we want to show diff relative to CWD
            const gitDiffProcess = spawn('git', ['diff', '--no-index', '--color', '.', diffFilePath], {
                stdio: 'inherit',
            });

            return new Promise((resolve, reject) => {
                gitDiffProcess.on('close', resolve.bind(null, diffFilePath)); // Shorter way to resolve with diffFilePath
                gitDiffProcess.on('error', reject);
            });

        } catch (error) {
            console.error("Error creating or showing diff:", error);
            await this.fs.deleteFile(diffFilePath);
            return null;
        }
    }

    async applyDiffWithStaging(diffFilePath) {
        if (!diffFilePath) {
            console.log("No diff file to apply.");
            return false;
        }

        try {
            // Use --directory to apply relative to projectRoot
            execSync(`git apply --directory="${this.projectRoot}" "${diffFilePath}"`, {
                stdio: 'inherit',
            });
            console.log('Changes applied and staged.');
            return true;
        } catch (error) {
            console.error('Error applying diff:', error);

            // Check if the error is due to the index
            if (error.message.includes('patch does not apply')) {
                console.log('\nAttempting to resolve conflicts with GPT-3.5...');

                // 1. Read the conflicted file(s)
                const diffContent = await this.fs.readFile(diffFilePath, 'utf-8');

                const filePaths = this.aiClient.extractFilePathsFromDiff(diffContent);

                if (filePaths.length === 0) {
                    console.error('No conflicted files found. Cannot resolve.');
                    await this.fs.deleteFile(diffFilePath); // Clean up
                    return false;
                }

                let resolved = true;
                for (const filePath of filePaths) {
                    const fullPath = path.join(this.projectRoot, filePath);
                    try {
                        const originalFileContent = await this.fs.readFile(fullPath, 'utf-8');
                        if (!originalFileContent) {
                            console.error(`Could not read the original file ${filePath}.`);
                            resolved = false; // Set flag
                            break; // Exit loop if can't read file.
                        }

                        const conflictedHunk = this.extractConflictedHunk(originalFileContent);

                        if (!conflictedHunk) {
                            console.error(`No conflict markers found in ${filePath}.`);
                            resolved = false;
                            break;
                        }

                        // 2. Call GPT-3.5 to resolve the conflict
                        const resolvedCode =
                            await this.aiClient.resolveConflictWithGPT3(
                                originalFileContent,
                                conflictedHunk,
                                this.lastUserPrompt
                            ); // Assuming you store the user prompt

                        if (!resolvedCode) {
                            console.error(`GPT-3.5 failed to resolve conflict in ${filePath}.`);
                            resolved = false;
                            break;
                        }

                        // 3. Replace the conflicted hunk with the resolved code
                        const newFileContent = originalFileContent.replace(conflictedHunk, resolvedCode);
                        await this.fs.writeFile(fullPath, newFileContent);
                        console.log(`Conflict in ${filePath} resolved with GPT-3.5.`);
                    } catch (fileReadError) {
                        console.error(`Error reading or processing file ${filePath}:`, fileReadError);
                        resolved = false; // Ensure we don't proceed if there's an error.
                        break;
                    }
                }

                if (resolved) {
                    //If no break happened in the loop.
                    // 4. Retry applying the original diff
                    console.log("Retrying 'git apply'...");
                    try {
                        execSync(`git apply --directory="${this.projectRoot}" "${diffFilePath}"`, {
                            stdio: 'inherit',
                        });
                        console.log('Changes applied and staged after conflict resolution.');
                        await this.fs.deleteFile(diffFilePath);
                        return true;
                    } catch (retryError) {
                        console.error('Failed again: ', retryError);
                        await this.fs.deleteFile(diffFilePath);
                        return false;
                    }
                } else {
                    //If any file gave trouble.
                    console.log('Conflict resolution failed.  Please resolve manually.');
                    await this.fs.deleteFile(diffFilePath);
                    return false;
                }
            }

            // Offer recovery options to the user:
            const { resolution } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'resolution',
                    message: 'Failed to apply diff. What would you like to do?',
                    choices: [
                        'Discard changes',
                        'Manually resolve conflicts (advanced)',
                        'Retry with a revised prompt', // This requires more work in main()
                    ],
                },
            ]);

            if (resolution === 'Discard changes') {
                await this.fs.deleteFile(diffFilePath);
                return false;
            } else if (resolution === 'Manually resolve conflicts') {
                console.log('Please manually resolve conflicts in the affected files.');
                console.log('After resolving, you can stage and commit the changes manually.');
                await this.fs.deleteFile(diffFilePath);
                return false; // Changes are NOT staged automatically
            } else if (resolution === 'Retry with a revised prompt') {
                await this.fs.deleteFile(diffFilePath);
                return false;
                // The main loop needs to handle this and re-prompt
            }
        }
    }
    extractConflictedHunk(fileContent) {
        const conflictStart = "<<<<<<<";
        const conflictDivider = "=======";
        const conflictEnd = ">>>>>>>";

        const startIndex = fileContent.indexOf(conflictStart);
        const endIndex = fileContent.indexOf(conflictEnd);

        if (startIndex === -1 || endIndex === -1) {
            return null; // No conflict markers found
        }

        return fileContent.substring(startIndex, endIndex + conflictEnd.length);
    }

    async commitChanges(userPrompt, diffFilePath) {
        try {
            // Use --directory for consistency
            execSync(`git commit -m "${userPrompt}"`, {
                stdio: 'inherit',
                cwd: this.projectRoot, // Commit in the project root
            });
            console.log("Changes committed.");
        } catch (error) {
            console.error("Error during git commit:", error);
            console.log("Changes might be staged but not committed. Please check manually.");
        } finally {
            await this.fs.deleteFile(diffFilePath);
        }
    }

    async askQuestion(userPrompt) {
        const preloadMessages = await this.buildPreloadPrompt(userPrompt);
        const questionMessage = { role: "user", parts: [{ text: userPrompt }] };
        const finalMessages = [...preloadMessages, questionMessage];

        const response = await this.aiClient.getResponseFromAI(finalMessages);
        console.log(response);
    }
}

export { CodeProcessor };