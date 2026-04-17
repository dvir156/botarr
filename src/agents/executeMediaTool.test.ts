import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTool } from './executeMediaTool.js';
import { clearPendingAction, getPendingAction, setPendingAction } from './pendingActions.js';
import * as radarrTools from '../tools/radarrTools.js';
import * as sonarrTools from '../tools/sonarrTools.js';

vi.mock('../tools/radarrTools.js', () => ({
  searchMovie: vi.fn(),
  addMovie: vi.fn(),
  checkMovieInRadarr: vi.fn(),
  previewMovieReleases: vi.fn(),
  grabMovieRelease: vi.fn()
}));

vi.mock('../tools/sonarrTools.js', () => ({
  searchSeries: vi.fn(),
  addSeries: vi.fn(),
  getSeriesEpisodeStats: vi.fn(),
  previewSeriesReleases: vi.fn(),
  previewEpisodeReleases: vi.fn(),
  resolveEpisodeInSonarr: vi.fn(),
  grabSeriesRelease: vi.fn()
}));

vi.mock('../tools/plexTools.js', () => ({
  checkAvailabilityInPlex: vi.fn()
}));

describe('executeTool', () => {
  const userId = 123;
  const grabMovieReleaseMock = vi.mocked(radarrTools.grabMovieRelease);
  const grabSeriesReleaseMock = vi.mocked(sonarrTools.grabSeriesRelease);

  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingAction(userId);
  });

  afterEach(() => {
    clearPendingAction(userId);
  });

  it('throws on malformed JSON arguments', async () => {
    await expect(
      executeTool({
        requestId: 'r1',
        telegramUserId: userId,
        name: 'searchMovie',
        rawArguments: '{not json',
        userText: 'x'
      })
    ).rejects.toThrow(/Invalid tool arguments JSON/);
  });

  it('throws on unknown tool name', async () => {
    await expect(
      executeTool({
        requestId: 'r1',
        telegramUserId: userId,
        name: 'notARealTool',
        rawArguments: '{}',
        userText: 'x'
      })
    ).rejects.toThrow(/Invalid tool name/);
  });

  it('blocks grabMovieRelease when there is no pending release pick', async () => {
    await expect(
      executeTool({
        requestId: 'r1',
        telegramUserId: userId,
        name: 'grabMovieRelease',
        rawArguments: JSON.stringify({ guid: 'g1' }),
        userText: 'grab it'
      })
    ).rejects.toThrow(/blocked: no pending pick/);
    expect(grabMovieReleaseMock).not.toHaveBeenCalled();
  });

  it('blocks grabSeriesRelease when pending exists but does not match requested guid/indexerId', async () => {
    const now = Date.now();
    setPendingAction(userId, {
      type: 'series_release_pick',
      createdAtMs: now,
      expiresAtMs: now + 60_000,
      items: [
        {
          label: 'x',
          toolName: 'grabSeriesRelease',
          toolArgs: { guid: 'good-guid', indexerId: 10 }
        }
      ]
    });

    await expect(
      executeTool({
        requestId: 'r1',
        telegramUserId: userId,
        name: 'grabSeriesRelease',
        rawArguments: JSON.stringify({ guid: 'bad-guid', indexerId: 10 }),
        userText: 'grab it'
      })
    ).rejects.toThrow(/blocked: release not in pending list/);
    expect(grabSeriesReleaseMock).not.toHaveBeenCalled();
    expect(getPendingAction(userId, Date.now())?.type).toBe('series_release_pick');
  });

  it('allows grabMovieRelease only when it matches pending list, and clears pending', async () => {
    const now = Date.now();
    setPendingAction(userId, {
      type: 'movie_release_pick',
      createdAtMs: now,
      expiresAtMs: now + 60_000,
      items: [
        {
          label: 'm',
          toolName: 'grabMovieRelease',
          toolArgs: { guid: 'g-ok' }
        }
      ]
    });

    grabMovieReleaseMock.mockResolvedValueOnce({ ok: true });

    await executeTool({
      requestId: 'r1',
      telegramUserId: userId,
      name: 'grabMovieRelease',
      rawArguments: JSON.stringify({ guid: 'g-ok' }),
      userText: '1'
    });

    expect(grabMovieReleaseMock).toHaveBeenCalledWith({ guid: 'g-ok' }, { requestId: 'r1' });
    expect(getPendingAction(userId, Date.now())).toBeNull();
  });
});
