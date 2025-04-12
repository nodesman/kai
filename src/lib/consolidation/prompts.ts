// src/lib/consolidation/prompts.ts

/**
 * Prompts used by the ConsolidationService (CLI version).
 */
export const ConsolidationPrompts = {
    /**
     * Generates the prompt for analyzing the conversation history to identify file operations.
     * @param codeContext The string containing the current codebase context.
     * @param historyString The stringified conversation history.
     * @returns The formatted analysis prompt.
     */
    analysisPrompt: (codeContext: string, historyString: string): string => `CONTEXT:
You are an expert AI analyzing a coding conversation to determine the necessary file changes.
CODEBASE CONTEXT:
${codeContext}
---
CONVERSATION HISTORY:
${historyString}
---
TASK:
Analyze the CONVERSATION HISTORY in the context of the CODEBASE CONTEXT. Identify all files that need to be created, modified, or deleted to fulfill the user's requests throughout the conversation.

Respond ONLY with a JSON object containing a single key "operations".
The "operations" key should be an array of objects, where each object has:
1.  "filePath": The relative path of the file from the project root (e.g., "src/lib/utils.ts").
2.  "action": A string, either "CREATE", "MODIFY", or "DELETE".

Example Response:
\`\`\`json
{
  "operations": [
    { "filePath": "src/newFeature.js", "action": "CREATE" },
    { "filePath": "README.md", "action": "MODIFY" },
    { "filePath": "old_scripts/cleanup.sh", "action": "DELETE" }
  ]
}
\`\`\`

If no file changes are implied by the conversation, respond with an empty "operations" array:
\`\`\`json
{
  "operations": []
}
\`\`\`

Do NOT include explanations, comments, or any other text outside the JSON object. Ensure the JSON is valid.`,

    /**
     * Generates the prompt for creating the final content of a single file.
     * @param codeContext The string containing the current codebase context.
     * @param historyString The stringified conversation history.
     * @param filePath The relative path of the file to generate content for.
     * @param currentContent The current content of the file (or null if it doesn't exist).
     * @returns The formatted file generation prompt.
     */
    individualFileGenerationPrompt: (
        codeContext: string,
        historyString: string,
        filePath: string,
        currentContent: string | null
    ): string => `CONTEXT:
You are an expert AI assisting with code generation based on a conversation.
CODEBASE CONTEXT:
${codeContext}
---
CONVERSATION HISTORY:
${historyString}
---
CURRENT FILE CONTENT for '${filePath}' (if it exists):
${currentContent === null ? '(File does not exist - generate content for creation)' : `\`\`\`\n${currentContent}\n\`\`\``}
---
TASK:
Based *only* on the conversation history and provided context/current content, generate the **complete and final content** for the single file specified below:
File Path: '${filePath}'

Respond ONLY with the raw file content for '${filePath}'.
Do NOT include explanations, markdown code fences (\`\`\`), file path headers, or any other text outside the file content itself.
If the conversation implies this file ('${filePath}') should ultimately be deleted, respond ONLY with the exact text "DELETE_FILE".`
};