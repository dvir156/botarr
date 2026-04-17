import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { getAgentEnv } from '../config/env.js';
import {
  HttpError,
  type HttpMethod,
  type OpenAiResponse,
  type OpenAiToolDefinition,
  type ToolName
} from '../types/index.js';

export type OpenAiInputItem =
  | {
      role: 'system' | 'user' | 'assistant';
      content: Array<{ type: 'input_text'; text: string }>;
    }
  | {
      type: 'function_call';
      call_id: string;
      name: ToolName;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    };

function toHttpError(args: {
  err: unknown;
  method: HttpMethod;
  url: string;
}): HttpError {
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

export class OpenAiClient {
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;

  constructor() {
    const env = getAgentEnv();
    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.trim().length === 0) {
      throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai_responses');
    }
    this.baseUrl = 'https://api.openai.com/v1';
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 45_000,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async createResponse(args: {
    model: string;
    input: OpenAiInputItem[];
    tools: OpenAiToolDefinition[];
  }): Promise<OpenAiResponse> {
    const url = `${this.baseUrl}/responses`;
    try {
      const res: AxiosResponse<OpenAiResponse> = await this.http.post(
        '/responses',
        {
          model: args.model,
          input: args.input,
          tools: args.tools
        }
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'POST', url });
    }
  }
}

