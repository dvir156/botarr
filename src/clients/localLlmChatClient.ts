import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { getAgentEnv } from '../config/env.js';
import { HttpError, type HttpMethod, type OpenAiToolDefinition } from '../types/index.js';

/** OpenAI Chat Completions shape: assistant with `tool_calls` must precede matching `role: tool` messages. */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ChatToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type ChatCompletionResponse = {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ChatToolCall[];
    };
    finish_reason: string | null;
  }>;
};

function toHttpError(args: { err: unknown; method: HttpMethod; url: string }): HttpError {
  if (axios.isAxiosError(args.err)) {
    const status = args.err.response?.status ?? null;
    const body = args.err.response?.data ?? null;
    return new HttpError({
      message: `HTTP ${args.method} ${args.url} failed`,
      status,
      method: args.method,
      url: args.url,
      responseBody: body
    });
  }
  return new HttpError({
    message: `HTTP ${args.method} ${args.url} failed`,
    status: null,
    method: args.method,
    url: args.url,
    responseBody: null
  });
}

export class LocalLlmChatClient {
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;

  constructor() {
    const env = getAgentEnv();
    this.baseUrl = env.LOCAL_LLM_BASE_URL;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 90_000,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async createChatCompletion(args: {
    model: string;
    messages: ChatMessage[];
    tools: OpenAiToolDefinition[];
  }): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    try {
      const res: AxiosResponse<ChatCompletionResponse> = await this.http.post('/chat/completions', {
        model: args.model,
        messages: args.messages,
        tools: args.tools,
        tool_choice: 'auto'
      });
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'POST', url });
    }
  }
}

