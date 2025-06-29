export const DiffFixPrompts = {
    fixPatch: (filePath: string, fileContent: string, brokenDiff: string, error: string): string => `Attempting to apply a unified diff to ${filePath} failed with error: ${error}\nCurrent file contents:\n\`\`\`\n${fileContent}\n\`\`\`\nBroken diff:\n\`\`\`diff\n${brokenDiff}\n\`\`\`\nPlease provide a corrected unified diff patch for ${filePath}. Respond only with the diff.`
};
export default DiffFixPrompts;
