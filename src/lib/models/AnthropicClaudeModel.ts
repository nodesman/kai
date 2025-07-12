import BaseModel from './BaseModel';
import { Config } from '../Config';
import { Message } from './Conversation';
import chalk from 'chalk';

/**
 * Model wrapper for Anthropic Claude via the @anthropic-ai/sdk.
 * Requires installing @anthropic-ai/sdk and setting ANTHROPIC_API_KEY.
 */
export default class AnthropicClaudeModel extends BaseModel {
  private client: any;
  public modelName: string;

  constructor(config: Config) {
    super(config);
    if (!config.anthropic?.api_key) {
      throw new Error('Anthropic API key is missing in the configuration.');
    }
    this.modelName = config.anthropic.model_name;
    // Lazy-load the SDK to avoid module errors when not using Anthropic
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Anthropic } = require('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: config.anthropic.api_key });
    } catch (err) {
      throw new Error(
        'Failed to load @anthropic-ai/sdk. Please install it to use Anthropic Claude models.'
      );
    }
  }

  /**
   * Sends a chat conversation to Claude and returns the assistant's response.
   */
  async getResponseFromAI(messages: Message[]): Promise<string> {
    if (!messages.length) {
      throw new Error('Cannot get AI response with empty message history.');
    }
    // Build the prompt using Anthropic's human/AI tags
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HUMAN_PROMPT, AI_PROMPT } = require('@anthropic-ai/sdk');
    let prompt = '';
    for (const msg of messages) {
      if (msg.role === 'user') {
        prompt += `${HUMAN_PROMPT} ${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        prompt += `${AI_PROMPT} ${msg.content}\n\n`;
      }
    }
    prompt += AI_PROMPT;

    const maxTokens =
      this.config.anthropic.max_output_tokens ?? this.config.gemini.max_output_tokens;
    const params: Record<string, any> = {
      model: this.modelName,
      prompt,
    };
    if (typeof maxTokens === 'number') {
      params.max_tokens_to_sample = maxTokens;
    }

    const response = await this.client.complete(params);
    const completion = response.completion;
    if (!completion) {
      throw new Error(`Anthropic Claude response missing completion text.`);
    }
    console.log(chalk.blue(`Received response from Claude (${completion.length} characters)`));
    return completion;
  }
}
