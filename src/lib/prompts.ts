// src/lib/prompts.ts

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