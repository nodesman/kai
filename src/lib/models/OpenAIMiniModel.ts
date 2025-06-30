import BaseModel from './BaseModel';
import { Config } from '../Config';
import { Message } from './Conversation';
import { OpenAI } from 'openai';

class OpenAIMiniModel extends BaseModel {
  openai: OpenAI;
  modelName: string;

  constructor(config: Config) {
    super(config);
    if (!config.openai?.api_key) {
      throw new Error('OpenAI API key is missing in the configuration.');
    }
    this.modelName = config.openai.model_name || 'gpt-3.5-turbo';
    this.openai = new OpenAI({ apiKey: config.openai.api_key });
  }

  async getResponseFromAI(messages: Message[]): Promise<string> {
    if (!messages || messages.length === 0) {
      throw new Error('Cannot get AI response with empty message history.');
    }
    const chatMessages = messages.map(m => ({ role: m.role as any, content: m.content }));
    try {
      const res = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: chatMessages,
      });
      const text = res.choices[0]?.message?.content;
      if (!text) throw new Error('OpenAI response missing content.');
      return text;
    } catch (err: any) {
      throw err;
    }
  }
}

export default OpenAIMiniModel;
