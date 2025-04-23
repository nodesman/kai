// src/lib/analysis/prompts.ts

export const AnalysisPrompts = {
    /**
     * Prompt for generating a brief summary of a single file.
     * Intended for use with a faster model like Gemini Flash.
     * @param filePath Relative path of the file.
     * @param fileContent The content of the file.
     * @returns The formatted prompt string.
     */
    summarizeFilePrompt: (filePath: string, fileContent: string): string => `
CONTEXT: You are an AI assistant analyzing a single source code file.
FILE PATH: ${filePath}
FILE CONTENT (may be truncated if large):
\`\`\`
${fileContent.substring(0, 20000)} ${fileContent.length > 20000 ? "\n\n[... content truncated ...]" : ""}
\`\`\`
---
TASK: Provide a very brief, pithy summary (1-2 sentences maximum) of the primary purpose or responsibility of this file based *only* on its content. Focus on *what* it does, not *how*. Avoid mentioning specific function names unless essential to the core purpose. Do NOT include any conversational filler, greetings, or sign-offs. Respond ONLY with the summary text.
`.trim(),

    /**
     * Prompt for generating brief summaries for a BATCH of files.
     * Intended for use with a faster model like Gemini Flash.
     * @param batchFileContent A string containing the concatenated content of multiple files,
     *                         each preceded by a 'File: <path>' header.
     * @param filePaths An array of the relative file paths included in the batch content.
     * @returns The formatted prompt string.
     */
    batchSummarizePrompt: (batchFileContent: string, filePaths: string[]): string => `
CONTEXT: You are an AI assistant analyzing a batch of source code files.
FILES IN BATCH:
${batchFileContent}
---
TASK: For EACH file listed above, provide a very brief, pithy summary (1-2 sentences maximum) of its primary purpose or responsibility based *only* on its content. Focus on *what* it does, not *how*.

Respond ONLY with a single JSON object containing a single key "summaries".
The value of "summaries" should be another JSON object where each key is the **exact relative file path** (e.g., "src/lib/utils.ts") provided in the input, and the value is the corresponding summary string.

Example Response Structure:
\`\`\`json
{
  "summaries": {
    "src/fileA.js": "This file defines utility functions for string manipulation.",
    "src/components/Button.tsx": "This component renders a reusable button element.",
    "path/to/another/file.py": "Handles database connection setup and querying."
  }
}
\`\`\`

Ensure ALL file paths provided in the input context have a corresponding key in the output "summaries" object. Do NOT include explanations, comments, or any other text outside the single JSON object response.
`.trim(),
};