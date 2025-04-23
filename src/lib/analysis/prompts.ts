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

    /**
     * Prompt for selecting relevant files based on summaries and a query.
     * Intended for use with a faster model like Gemini Flash.
     * @param userQuery The current user query or request.
     * @param historySummary A brief summary of recent conversation history (optional).
     * @param cacheSummary A formatted string listing files, types, sizes, and summaries from the cache.
     * @param fileContentTokenBudget The approximate token budget available for loading full file content.
     * @returns The formatted prompt string.
     */
    selectRelevantFilesPrompt: (
        userQuery: string,
        historySummary: string | null,
        cacheSummary: string,
        fileContentTokenBudget: number
    ): string => `
CONTEXT: You are an AI assistant responsible for selecting the most relevant files to include in the context for answering a user's query based on a project analysis summary.

USER QUERY:
${userQuery}

${historySummary ? `RECENT CONVERSATION SUMMARY:\n${historySummary}\n` : ''}
PROJECT ANALYSIS SUMMARY:
${cacheSummary}
---
TASK: Analyze the User Query (and Conversation Summary, if provided) in the context of the Project Analysis Summary. Identify the files whose **full content** is most likely needed to address the user's query accurately and completely.

Consider the file summaries, types, and sizes. The total token count of the full content of the files you select should ideally fit within a budget of approximately **${fileContentTokenBudget} tokens**. Prioritize files directly related to the query's entities and actions. Include essential configuration or utility files if relevant. Do not select binary files unless the query specifically asks about them.

Respond ONLY with a list of the selected relative file paths, one path per line. Do NOT include explanations, apologies, greetings, or any other text. If no files seem particularly relevant, respond with "NONE".

Example Response:
src/controllers/UserController.ts
src/views/user/profile.html
src/models/User.ts
config/routes.ts
`.trim(),
};