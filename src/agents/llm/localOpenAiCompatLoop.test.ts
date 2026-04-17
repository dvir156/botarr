import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ChatMessage } from '../../clients/localLlmChatClient.js';
import { runLocalOpenAiCompatChatLoop } from './localOpenAiCompatLoop.js';
import * as executeMediaTool from '../executeMediaTool.js';
import * as pendingActions from '../pendingActions.js';

const createChatCompletionMock = vi.fn();

vi.mock('../../config/env.js', () => ({
  getAgentEnv: () => ({
    LLM_PROVIDER: 'local_openai_compat',
    LLM_MODEL: 'llama-test',
    OPENAI_API_KEY: '',
    LOCAL_LLM_BASE_URL: 'http://localhost:11434/v1'
  })
}));

vi.mock('../../clients/localLlmChatClient.js', () => {
  return {
    LocalLlmChatClient: class {
      createChatCompletion = createChatCompletionMock;
    }
  };
});

vi.mock('../executeMediaTool.js', () => ({
  executeTool: vi.fn()
}));

const executeToolMock = vi.mocked(executeMediaTool.executeTool);

describe('runLocalOpenAiCompatChatLoop (bot-owned search UI)', () => {
  const userId = 888;

  beforeEach(() => {
    vi.clearAllMocks();
    pendingActions.clearPendingAction(userId);
  });

  afterEach(() => {
    pendingActions.clearPendingAction(userId);
  });

  it('short-circuits on searchSeries: sets pending action and returns deterministic list', async () => {
    createChatCompletionMock.mockResolvedValue({
      id: 'c1',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'searchSeries', arguments: JSON.stringify({ title: 'severance' }) }
              }
            ]
          }
        }
      ]
    });

    executeToolMock.mockResolvedValue({
      matches: [
        {
          title: 'Severance',
          year: 2022,
          tvdbId: 100,
          overview: null,
          tmdbUrl: 'https://www.themoviedb.org/tv/200',
          tvdbUrl: 'https://thetvdb.com/?tab=series&id=100'
        },
        {
          title: 'Severance (Other)',
          year: 2000,
          tvdbId: 101,
          overview: null,
          tmdbUrl: null,
          tvdbUrl: 'https://thetvdb.com/?tab=series&id=101'
        }
      ]
    });

    const res = await runLocalOpenAiCompatChatLoop({
      requestId: 'req-2',
      telegramUserId: userId,
      userText: 'download severance',
      systemPrompt: 'sys'
    });

    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramUserId: userId,
        name: 'searchSeries'
      })
    );

    const pending = pendingActions.getPendingAction(userId, Date.now());
    expect(pending?.type).toBe('series_search_pick');
    expect(pending && 'items' in pending ? pending.items : []).toEqual([
      { tvdbId: 100, label: 'Severance (2022)' },
      { tvdbId: 101, label: 'Severance (Other) (2000)' }
    ]);

    expect(res.replyText).toContain('Here are matches:');
    expect(res.replyText).toContain('1. Severance (2022) - https://thetvdb.com/?tab=series&id=100, https://www.themoviedb.org/tv/200');
    expect(res.replyText).toContain('2. Severance (Other) (2000) - https://thetvdb.com/?tab=series&id=101');
  });

  it('sends assistant message with tool_calls before tool results for a second completion round', async () => {
    createChatCompletionMock
      .mockResolvedValueOnce({
        id: 'round1',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_plex',
                  type: 'function',
                  function: {
                    name: 'checkAvailabilityInPlex',
                    arguments: JSON.stringify({ title: 'Example' })
                  }
                }
              ]
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'round2',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: 'Proceeding.',
              tool_calls: undefined
            }
          }
        ]
      });

    executeToolMock.mockResolvedValueOnce({
      available: false,
      matches: []
    });

    const res = await runLocalOpenAiCompatChatLoop({
      requestId: 'req-chain',
      telegramUserId: userId,
      userText: 'add Example',
      systemPrompt: 'sys'
    });

    expect(createChatCompletionMock).toHaveBeenCalledTimes(2);
    const secondMessages = createChatCompletionMock.mock.calls[1][0].messages as ChatMessage[];
    const assistantWithTools = secondMessages.find(
      (m) =>
        m.role === 'assistant' &&
        'tool_calls' in m &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.length > 0
    );
    expect(assistantWithTools).toBeDefined();
    expect(secondMessages.some((m) => m.role === 'tool' && 'tool_call_id' in m)).toBe(true);
    expect(res.replyText).toBe('Proceeding.');
  });
});

