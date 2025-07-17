import BaseModel from './BaseModel';
import { Config } from '../Config';
import { Message } from './Conversation';
import chalk from 'chalk';
import {
  BlockReason,
  FinishReason,
  GenerateContentRequest,
  GenerateContentResult,
} from '@google/generative-ai';

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

  async generateContent(
    request: GenerateContentRequest
  ): Promise<GenerateContentResult> {
    let systemPrompt = '';
    const messages = request.contents
      .map((c) => {
        if (c.role === 'system') {
          systemPrompt = c.parts.map((p) => ('text' in p ? p.text : '')).join('');
          return null; // Remove system message from the array
        }
        return {
          role: c.role === 'model' ? 'assistant' : c.role,
          content: c.parts.map((p) => ('text' in p ? p.text : '')).join(''),
        };
      })
      .filter(Boolean); // Filter out null entries

    const params: any = {
      model: this.modelName,
      messages: messages,
      max_tokens:
        this.config.anthropic?.max_output_tokens ??
        this.config.gemini.max_output_tokens,
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    const response = await this.client.messages.create(params);

    const responseText = response.content[0].text;

    return {
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: responseText }],
              role: 'assistant',
            },
            finishReason: FinishReason.STOP,
            index: 0,
            safetyRatings: [],
          },
        ],
        promptFeedback: {
          blockReason: BlockReason.BLOCKED_REASON_UNSPECIFIED,
          safetyRatings: [],
        },
        text: () => responseText,
        functionCall: () => undefined,
        functionCalls: () => undefined,
      },
    };
  }

  /**
   * Sends a chat conversation to Claude and returns the assistant's response.
   */
  async getResponseFromAI(messages: Message[]): Promise<string> {
    if (!messages.length) {
      throw new Error('Cannot get AI response with empty message history.');
    }

    let systemPrompt = '';
    const filteredMessages = messages
      .map((msg) => {
        if (msg.role === 'system') {
          systemPrompt = msg.content;
          return null;
        }
        return {
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        };
      })
      .filter(Boolean);

    const maxTokens =
      this.config.anthropic.max_output_tokens ??
      this.config.gemini.max_output_tokens;
    const params: any = {
      model: this.modelName,
      messages: filteredMessages,
      max_tokens: maxTokens,
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    const response = await this.client.messages.create(params);
    const completion = response.content[0].text;
    if (!completion) {
      throw new Error(`Anthropic Claude response missing completion text.`);
    }
    console.log(
      chalk.blue(`Received response from Claude (${completion.length} characters)`)
    );
    return completion;
  }
}