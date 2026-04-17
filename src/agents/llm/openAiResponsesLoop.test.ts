import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runOpenAiResponsesLoop } from './openAiResponsesLoop.js';
import * as executeMediaTool from '../executeMediaTool.js';
import * as pendingActions from '../pendingActions.js';

const createResponseMock = vi.fn();

vi.mock('../../config/env.js', () => ({
  getAgentEnv: () => ({
    LLM_PROVIDER: 'openai_responses',
    LLM_MODEL: 'gpt-test',
    OPENAI_API_KEY: 'test-key',
    LOCAL_LLM_BASE_URL: 'http://localhost:11434/v1'
  })
}));

vi.mock('../../clients/openaiClient.js', () => {
  return {
    OpenAiClient: class {
      createResponse = createResponseMock;
    }
  };
});

vi.mock('../executeMediaTool.js', () => ({
  executeTool: vi.fn()
}));

const executeToolMock = vi.mocked(executeMediaTool.executeTool);

describe('runOpenAiResponsesLoop (bot-owned search UI)', () => {
  const userId = 777;

  beforeEach(() => {
    vi.clearAllMocks();
    pendingActions.clearPendingAction(userId);
  });

  afterEach(() => {
    pendingActions.clearPendingAction(userId);
  });

  it('short-circuits on searchMovie: sets pending action and returns deterministic list', async () => {
    // Arrange: fake OpenAI response containing a function call.
    createResponseMock.mockResolvedValue({
      id: 'r1',
      output: [
        {
          type: 'function_call',
          call_id: 'c1',
          name: 'searchMovie',
          arguments: JSON.stringify({ title: 'dune' })
        }
      ]
    });

    executeToolMock.mockResolvedValue({
      matches: [
        {
          title: 'Dune',
          year: 2021,
          tmdbId: 111,
          overview: null,
          tmdbUrl: 'https://www.themoviedb.org/movie/111'
        },
        {
          title: 'Dune',
          year: 1984,
          tmdbId: 222,
          overview: null,
          tmdbUrl: 'https://www.themoviedb.org/movie/222'
        }
      ]
    });

    // Act
    const res = await runOpenAiResponsesLoop({
      requestId: 'req-1',
      telegramUserId: userId,
      userText: 'download dune',
      systemPrompt: 'sys'
    });

    // Assert
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramUserId: userId,
        name: 'searchMovie'
      })
    );

    const pending = pendingActions.getPendingAction(userId, Date.now());
    expect(pending?.type).toBe('movie_search_pick');
    expect(pending && 'items' in pending ? pending.items : []).toEqual([
      { tmdbId: 111, label: 'Dune (2021)' },
      { tmdbId: 222, label: 'Dune (1984)' }
    ]);

    expect(res.replyText).toContain('Here are matches:');
    expect(res.replyText).toContain('1. Dune (2021) - https://www.themoviedb.org/movie/111');
    expect(res.replyText).toContain('2. Dune (1984) - https://www.themoviedb.org/movie/222');
  });
});

