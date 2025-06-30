import chalk from 'chalk';
import { FileSystem, DiffFailureInfo } from './FileSystem';
import { AIClient } from './AIClient';
import DiffFixPrompts from './prompts/DiffFixPrompts';

/**
 * Applies a diff to a file, asking the AI to repair the diff if it fails.
 * Attempts up to `maxAttempts` times and returns true if applied successfully.
 */
export async function applyDiffIteratively(
    fs: FileSystem,
    ai: AIClient,
    filePath: string,
    diff: string,
    maxAttempts = 10
): Promise<boolean> {
    // Always request corrected diffs from the Gemini Pro model (gemini-2.5-pro)
    // because it generally produces higher-quality patches than the cheaper
    // Flash model.  The boolean flag is inverted in AIClient: `false` chooses
    // the primary/pro model.
    const USE_PRO_MODEL = false;
    let currentDiff = diff;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (currentDiff.trim().length === 0) {
            console.warn(
                chalk.yellow(`Empty diff provided for ${filePath}; stopping.`)
            );
            break;
        }

        const applied = await fs.applyDiffToFile(filePath, currentDiff);
        if (applied) return true;

        // If this was the last allowed attempt, exit early without
        // requesting another diff from the AI.
        if (attempt === maxAttempts - 1) {
            return false;
        }

        const info: DiffFailureInfo = fs.lastDiffFailure || {
            file: filePath,
            diff: currentDiff,
            fileContent: (await fs.readFile(filePath)) ?? '',
            error: undefined,
        };

        console.warn(
            chalk.yellow(
                `Diff application failed for ${filePath}. Attempt ${attempt + 1}/${maxAttempts}.`
            )
        );

        const prompt = DiffFixPrompts.fixPatch(
            filePath,
            info.fileContent,
            currentDiff,
            info.error || ''
        );
        try {
            currentDiff = await ai.getResponseTextFromAI(
                [{ role: 'user', content: prompt }],
                USE_PRO_MODEL
            );
        } catch (err) {
            console.error(chalk.red('Failed to get corrected diff from AI:'), err);
            return false;
        }
    }
    return false;
}
