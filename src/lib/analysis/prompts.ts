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
};