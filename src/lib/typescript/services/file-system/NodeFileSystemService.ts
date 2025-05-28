import * as fs from 'fs/promises';
import * as path from 'path';
import { applyPatch, createPatch } from 'diff';
import { IFileSystemService } from './IFileSystemService';

export class NodeFileSystemService implements IFileSystemService {
  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error: any) {
      console.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  }

  async ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error: any) {
      console.error(`Error creating directory ${dir}:`, error);
      throw error;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      await this.ensureDirectoryExists(filePath);
      await fs.writeFile(filePath, content, 'utf-8');
      console.log(`File written successfully: ${filePath}`);
    } catch (error: any) {
      console.error(`Error writing file ${filePath}:`, error);
      throw error;
    }
  }

  async applyDiff(filePath: string, diffContent: string): Promise<void> {
    // Note: The 'diff' library's applyPatch is for string-to-string application.
    // It does not directly take a unified diff string meant for patching files in a git-like way
    // without more complex parsing of the diffContent first.
    // The 'apply-patch' library installed seems to be a CLI tool or for specific patch file formats.

    // For this implementation, we will assume `diffContent` IS a unified diff string.
    // We'll read the old content, apply the patch, and write the new content.

    console.log(`Attempting to apply diff to ${filePath}`);
    let oldContent: string;
    let fileInitiallyExisted = true;
    try {
      oldContent = await this.readFile(filePath);
    } catch (e: any) {
      const error = e as NodeJS.ErrnoException; // Type assertion
      // If the file doesn't exist, and the diff is for creating a new file.
      // A standard unified diff for a new file starts with '--- /dev/null' and '+++ b/filepath'.
      if (error.code === 'ENOENT' && diffContent.startsWith('--- /dev/null')) {
        oldContent = ''; // Treat as empty for new file creation via diff
        fileInitiallyExisted = false;
        console.log(`File ${filePath} does not exist. Attempting to create from diff.`);
      } else {
        console.error(`Error reading file ${filePath} for applying diff:`, error);
        throw error;
      }
    }

    try {
      // The `applyPatch` function from the 'diff' library expects the old content and a patch object or string.
      // If `diffContent` is a standard unified diff string, it should work.
      const newContentOrFalse = applyPatch(oldContent, diffContent);

      if (typeof newContentOrFalse !== 'string') {
        // This means the patch did not apply cleanly.
        // This can happen if the diffContent is not a valid patch for oldContent or if it's malformed.
        console.error(`Failed to apply patch to ${filePath}. The diff may be invalid or not applicable.`);
        // Throw specific error, let the fallback logic below handle it if appropriate
        throw new Error(`Patch application failed for ${filePath}. Diff content might be invalid or not applicable to the file's current state.`);
      }
      
      const newContent = newContentOrFalse; // Now it's definitely a string

      if (newContent === oldContent && fileInitiallyExisted) { // Only warn if file existed and content is same
        console.warn(`Diff application to ${filePath} resulted in no changes to existing file.`);
        return; // No need to write if content is identical and file existed
      }
      
      // If the file didn't exist initially, or if content changed, write the file.
      // This handles new file creation from diff and updates to existing files.
      if (!fileInitiallyExisted || newContent !== oldContent) {
         // This condition is tricky. If oldContent was '' because the file didn't exist,
         // and applyPatch results in an empty newContent (e.g. diff to delete all from non-existent file),
         // we probably should not write an empty file unless specifically intended.
             // However, if the diff *adds* content to a new file, newContent will not be empty.
        if (!fileInitiallyExisted && newContent === '') {
          console.log(`Skipping write for ${filePath} as diff resulted in empty content for a new file.`);
        } else {
          await this.writeFile(filePath, newContent);
          console.log(`Diff applied and file written successfully: ${filePath}`);
        }
      } else if (newContent === oldContent && !fileInitiallyExisted && newContent !== '') {
        // This case handles if the file did not exist, but the patch applied successfully to create newContent (which is not empty)
        await this.writeFile(filePath, newContent);
        console.log(`File ${filePath} created successfully from diff.`);
      }


    } catch (error: any) {
      // Fallback: If applyPatch fails (e.g. diff format not compatible, conflicts, or our explicit throw above)
      console.warn(`Diff application processing failed for ${filePath}: ${error.message}.`);
      console.warn("Consider if the AI should provide full content for this file, or if the diff is malformed.");
      // As a very basic fallback, if the "diffContent" looks like a complete file
      // (e.g., doesn't have '---' '+++' '@@' typical of diffs), one might choose to writeFile.
      // However, this is risky. For now, we will throw an error if applyPatch fails.
      // A more robust solution would involve more sophisticated diff parsing and conflict resolution.
      
      // Let's check if diffContent looks like a diff or full content
      const isLikelyDiff = /^(--- a\/|\+\+\+ b\/|@@ -\d+,\d+ \+\d+,\d+ @@)/m.test(diffContent);
      if (!isLikelyDiff && diffContent.length > 0) { // It doesn't look like a diff, and it's not empty
          console.log(`Attempting writeFile fallback for ${filePath} as content does not appear to be a diff.`);
          // This is the fallback mentioned in the requirements: "act like writeFile if the 'diffContent' is actually full file content"
          await this.writeFile(filePath, diffContent); 
          console.log(`Fallback writeFile successful for ${filePath}.`);
      } else {
          console.error(`Cannot apply patch to ${filePath}. Content appears to be a diff, but application failed. Error: ${error.message}`);
          throw new Error(`Failed to apply diff to ${filePath}. Error: ${error.message}. Ensure the diff is valid or provide full file content.`);
      }
    }
  }
}
