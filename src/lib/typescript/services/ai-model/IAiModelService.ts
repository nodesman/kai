export interface IAiModelService {
  /**
   * Sends a prompt to an AI model and returns the response.
   *
   * @param systemMessage - Instructions for the AI's role, tone, output format.
   * @param userPrompt - The specific task or question for the AI.
   * @param context - Optional, any additional structured data to provide (e.g., code snippets, error details).
   * @returns A promise that resolves to the AI's response as a string.
   */
  prompt(systemMessage: string, userPrompt: string, context?: any): Promise<string>;
}
