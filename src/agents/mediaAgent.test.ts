import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaAgent } from './mediaAgent.js';
import * as pendingActions from './pendingActions.js';
import * as executeMediaTool from './executeMediaTool.js';
import * as openAiLoop from './llm/openAiResponsesLoop.js';

vi.mock('./executeMediaTool.js', () => ({
  executeTool: vi.fn()
}));

vi.mock('./llm/openAiResponsesLoop.js', () => ({
  runOpenAiResponsesLoop: vi.fn()
}));

vi.mock('./llm/localOpenAiCompatLoop.js', () => ({
  runLocalOpenAiCompatChatLoop: vi.fn()
}));

vi.mock('../config/env.js', () => ({
  getAgentEnv: () => ({
    LLM_PROVIDER: 'openai_responses',
    LLM_MODEL: 'gpt-test',
    OPENAI_API_KEY: 'test-key',
    LOCAL_LLM_BASE_URL: 'http://localhost:11434/v1'
  })
}));

vi.mock('../preferences/preferencesRepo.js', () => ({
  createPreferencesRepo: () => ({
    get: () => ({
      preferredResolution: 'any',
      preferHevc: null,
      blockKeywords: [],
      preferKeywords: [],
      maxSizeGb: null,
      minSeeders: null,
      language: null,
      notes: null
    }),
    formatForPrompt: () => '## User preferences\n- Preferred resolution: any',
    setPatch: () => ({}),
    reset: () => ({})
  })
}));

const executeToolMock = vi.mocked(executeMediaTool.executeTool);
const runOpenAiMock = vi.mocked(openAiLoop.runOpenAiResponsesLoop);

const twoMovieListReply = `Here are matches:

1. Alpha (2024) - https://www.themoviedb.org/movie/111
2. Beta (2023) - https://www.themoviedb.org/movie/222`;

describe('mediaAgent', () => {
  const userId = 424242;

  beforeEach(() => {
    vi.clearAllMocks();
    pendingActions.clearPendingAction(userId);
    executeToolMock.mockReset();
    runOpenAiMock.mockReset();
  });

  afterEach(() => {
    pendingActions.clearPendingAction(userId);
  });

  it('with movie_search_pick pending, numeric message calls previewMovieReleases for that row', async () => {
    const now = Date.now();
    pendingActions.setPendingAction(userId, {
      type: 'movie_search_pick',
      createdAtMs: now,
      expiresAtMs: now + 60_000,
      items: [
        { tmdbId: 986056, label: 'Thunderbolts (2025)' },
        { tmdbId: 624653, label: 'Other' }
      ]
    });

    executeToolMock.mockResolvedValue({
      movieId: 1,
      tmdbId: 986056,
      candidates: [
        {
          guid: 'g1',
          title: 'Release A',
          quality: '1080p',
          seeders: 10,
          leechers: 1,
          sizeBytes: 1e9
        }
      ],
      recommendedChoice: 1,
      recommendationHint: 'High seeders'
    });

    const res = await mediaAgent({ text: '1', telegramUserId: userId });

    expect(executeToolMock).toHaveBeenCalledTimes(1);
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'previewMovieReleases',
        rawArguments: JSON.stringify({ tmdbId: 986056, limit: 5 }),
        telegramUserId: userId
      })
    );
    expect(res.replyText).toContain('Available releases for Thunderbolts (2025)');
  });

  it('after LLM returns a numbered movie list, registers movie_search_pick', async () => {
    runOpenAiMock.mockResolvedValue({ replyText: twoMovieListReply });

    const setSpy = vi.spyOn(pendingActions, 'setPendingAction');

    await mediaAgent({ text: 'download something', telegramUserId: userId });

    expect(setSpy).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        type: 'movie_search_pick',
        items: [
          { tmdbId: 111, label: 'Alpha (2024)' },
          { tmdbId: 222, label: 'Beta (2023)' }
        ]
      })
    );
    setSpy.mockRestore();
  });
});
