import BaseModel from './BaseModel';
import chalk from 'chalk';
import { Config } from '../Config';
import { Message } from './Conversation';
import { encode as gpt3Encode, decode as gpt3Decode } from 'gpt-3-encoder';
import OpenAI from 'openai';

export default class OpenAIChatModel extends BaseModel {
  private client: OpenAI;
  public modelName: string;
  private maxPromptTokens: number;

  constructor(config: Config, modelName: string) {
    super(config);
    if (!config.openai?.api_key) {
      throw new Error('OpenAI API key is missing in the configuration.');
    }
    this.client = new OpenAI({ apiKey: config.openai.api_key });
    this.modelName = modelName;
    this.maxPromptTokens = config.openai.max_prompt_tokens || 128000;
  }

  private countTokens(text: string): number {
    return gpt3Encode(text).length;
  }

  private chunkByTokens(text: string, maxTokens: number): string[] {
    const tokens = gpt3Encode(text);
    const chunks: string[] = [];
    for (let i = 0; i < tokens.length; i += maxTokens) {
      const slice = tokens.slice(i, i + maxTokens);
      chunks.push(gpt3Decode(slice));
    }
    return chunks;
  }

  private async callOpenAI(messages: { role: string; content: string }[]): Promise<string> {
    const res = await (this.client.chat.completions.create as any)({
      model: this.modelName,
      messages: messages as any,
    });
    return res.choices?.[0]?.message?.content?.trim() || '';
  }

  async getResponseFromAI(messages: Message[]): Promise<string> {
    if (!messages.length) {
      throw new Error('Cannot get AI response with empty message history.');
    }
    const chatMessages = messages.map(m => ({ role: m.role, content: m.content }));
    const totalTokens = this.countTokens(chatMessages.map(m => m.content).join(' '));
    if (totalTokens <= this.maxPromptTokens) {
      console.log(chalk.dim(`OpenAI: prompt within limit (${totalTokens}/${this.maxPromptTokens} tokens).`));
      return this.callOpenAI(chatMessages);
    }

    const history = chatMessages.slice(0, -1);
    const last = chatMessages[chatMessages.length - 1];
    const historyTokens = this.countTokens(history.map(m => m.content).join(' '));
    const chunkLimit = Math.max(1, this.maxPromptTokens - historyTokens - 10);
    const chunks = this.chunkByTokens(last.content, chunkLimit);
    console.log(chalk.dim(`OpenAI: batching user content into ${chunks.length} chunk(s). Limit per chunk ~${chunkLimit} tokens (history: ${historyTokens}).`));
    let response = '';
    let runningHistory = [...history];
    for (let i = 0; i < chunks.length; i++) {
      const chunkTokens = this.countTokens(chunks[i]);
      console.log(chalk.dim(`  -> Sending chunk ${i + 1}/${chunks.length} (${chunkTokens} tokens)`));
      runningHistory.push({ role: 'user', content: chunks[i] });
      response = await this.callOpenAI(runningHistory);
      runningHistory.push({ role: 'assistant', content: response });
    }
    console.log(chalk.dim(`OpenAI: completed ${chunks.length} chunk round(s).`));
    return response;
  }

  async generateContent(request: any): Promise<any> {
    const messages = (request.contents || []).map((c: any) => ({
      role: c.role,
      content: (c.parts || []).map((p: any) => p.text).join(''),
    }));
    const text = await this.callOpenAI(messages);
    return {
      response: {
        candidates: [
          {
            content: { parts: [{ text }] },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [],
          },
        ],
        promptFeedback: {},
      },
    };
  }
}
