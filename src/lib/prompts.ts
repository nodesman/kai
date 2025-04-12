// src/lib/prompts.ts

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


/**
 * Prompts used by the CodeProcessor (WebSocket version).
 */
export const WebSocketPrompts = {
    /**
     * Generates the prompt structure for asking the AI a question or requesting changes,
     * embedding the user's specific prompt.
     * @param userPrompt The user's input prompt.
     * @returns The formatted prompt including instructions for the AI.
     */
    instructedPrompt: (userPrompt: string): string => `
${userPrompt}

Give a concise answer with code changes ONLY, in a SINGLE response:
    - Do NOT provide multiple options or alternatives.
    - Focus on the most sustainable and maintainable solution.
    - Include file creation, deletion, or moves in the diff if necessary.
    - Use the unified diff format and do not hallucinate filenames, only use file names that I have provided in the file context.
    - If the changes required are extensive, omit the explanation and include ONLY the diff.
    - The changes you suggest MUST be comprehensive. Do not suggest partial code snippets that will not run.
`,

    /**
     * Generates the prompt to ask an AI (like gpt-4o-mini) if a user prompt is requesting code changes.
     * @param userPrompt The user's original prompt.
     * @returns The formatted check prompt.
     */
    diffCheckPrompt: (userPrompt: string): string => `Does the following user prompt request changes to existing files in the codebase, including modifications or additions to existing files?
The prompt may be a generic question about the code base or not at all. Or a qeustion about how things are currenlty working. Or a question about how to achieve
something in the code base. I am looking for the case where the user is asking how to get this code to work a certain way or what a certain outcome entail in terms of
code changes. Respond with "true" or "false".

${userPrompt}`,

    /**
     * Generates the prompt to ask an AI (like gpt-4o-mini) if an AI response contains explanations beyond code/diffs.
     * @param aiResponseMessage The text content of the AI's response.
     * @returns The formatted check prompt.
     */
    commentCheckPrompt: (aiResponseMessage: string): string => `Does the following text contain text other than diff of code - such as text explaining the code changes and other text?? Respond with "true" or "false".

${aiResponseMessage}`,

    /**
     * Generates the prompt to ask an AI (like gpt-4o-mini) to analyze another AI's response
     * and extract diff status, explanation status, filenames, explanation text, and the core message.
     * @param aiResponseString The full response string from the primary AI.
     * @returns The formatted analysis prompt.
     */
    responseAnalysisPrompt: (aiResponseString: string): string => `Analyze the following response from the AI. Determine if it contains only a unified diff, or if it also contains explanatory text. Extract all mentioned filenames.  Return a JSON object in the following format:
{
  "containsDiff": boolean, // true if the response contains a diff, false otherwise
  "containsExplanation": boolean,  // true if there's explanatory text, false otherwise
  "files": string[], // An array of filenames extracted from the diff (if present)
  "explanation": string | null, // The explanation text, or null if no explanation.
  "message": string // main message
}
Ensure that the JSON object is valid. Do not wrap the JSON with markdown code blocks.

AI Response:
${aiResponseString}
`
};