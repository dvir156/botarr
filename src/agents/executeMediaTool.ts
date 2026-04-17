import { RadarrClient } from '../clients/radarrClient.js';
import { logger } from '../config/logger.js';
import { ToolPolicyError, isToolName, type ToolName } from '../types/index.js';
import {
  addMovie,
  checkMovieInRadarr,
  grabMovieRelease,
  previewMovieReleases,
  searchMovie
} from '../tools/radarrTools.js';
import {
  addSeries,
  getSeriesEpisodeStats,
  grabSeriesRelease,
  previewEpisodeReleases,
  previewSeriesReleases,
  resolveEpisodeInSonarr,
  searchSeries
} from '../tools/sonarrTools.js';
import { checkAvailabilityInPlex } from '../tools/plexTools.js';
import { clearPendingAction, getPendingAction, setPendingAction } from './pendingActions.js';
import { createPreferencesRepo } from '../preferences/preferencesRepo.js';
let cachedPrefsRepo: ReturnType<typeof createPreferencesRepo> | null = null;

function getPrefsRepo() {
  if (!cachedPrefsRepo) cachedPrefsRepo = createPreferencesRepo();
  return cachedPrefsRepo;
}

type SonarrPreviewCandidate = {
  guid: string;
  title: string;
  quality: string | null;
  seeders: number | null;
  leechers: number | null;
  indexerId: number | null;
};

/** Pending grab items aligned with grabbable Sonarr releases only (positive indexerId). */
function pendingItemsFromSonarrCandidates(candidates: SonarrPreviewCandidate[]): Array<{
  label: string;
  toolName: 'grabSeriesRelease';
  toolArgs: { guid: string; indexerId: number };
}> {
  return candidates
    .filter(
      (c): c is SonarrPreviewCandidate & { indexerId: number } =>
        typeof c.indexerId === 'number' && Number.isFinite(c.indexerId) && c.indexerId > 0
    )
    .map((c) => ({
      label: `${c.title} | ${c.quality ?? 'unknown'} | S:${c.seeders ?? 0} L:${c.leechers ?? 0}`,
      toolName: 'grabSeriesRelease' as const,
      toolArgs: { guid: c.guid, indexerId: c.indexerId }
    }));
}

async function getRadarrQualityProfileIdFromText(args: {
  requestId: string;
  userText: string;
  telegramUserId?: number;
}): Promise<number> {
  const client = new RadarrClient();
  const profiles = await client.getQualityProfiles();
  const prefs =
    typeof args.telegramUserId === 'number'
      ? getPrefsRepo().get(args.telegramUserId)
      : null;
  const wants4kFromText = /\b(4k|2160p|2160)\b/i.test(args.userText);
  const wants4kFromPrefs = prefs?.preferredResolution === '2160p';
  const wants4k = wants4kFromText || wants4kFromPrefs;

  const byName = (re: RegExp) => profiles.find((p) => re.test(p.name));
  const chosen =
    (wants4k ? byName(/4k|2160/i) : undefined) ?? byName(/hd-?1080p/i) ?? profiles[0];

  if (!chosen) throw new Error('Radarr has no quality profiles configured.');
  logger.child({ requestId: args.requestId }).info('qualityProfile.selected', {
    wants4k,
    wants4kFromText,
    wants4kFromPrefs,
    qualityProfileId: chosen.id,
    qualityProfileName: chosen.name
  });
  return chosen.id;
}

function parseToolArgumentsJson(raw: string): unknown {
  const s = (raw ?? '').trim();
  try {
    return JSON.parse(s.length > 0 ? s : '{}');
  } catch {
    throw new Error('Invalid tool arguments JSON');
  }
}

function requirePendingGrabAuthorization(args: {
  telegramUserId: number | undefined;
  name: Extract<ToolName, 'grabMovieRelease' | 'grabSeriesRelease'>;
  parsedArgs: unknown;
}): void {
  if (typeof args.telegramUserId !== 'number') {
    throw new ToolPolicyError({
      message: `${args.name} requires telegramUserId`,
      userMessage: 'Pick a release number first (or say cancel).'
    });
  }

  const pending = getPendingAction(args.telegramUserId, Date.now());
  if (!pending) {
    throw new ToolPolicyError({
      message: `${args.name} blocked: no pending pick`,
      userMessage: 'Pick a release number first (or say cancel).'
    });
  }

  const guid = (args.parsedArgs as { guid?: unknown } | null | undefined)?.guid;
  if (typeof guid !== 'string' || guid.trim().length === 0) {
    throw new ToolPolicyError({
      message: `${args.name} blocked: missing guid`,
      userMessage: 'Pick a release number first (or say cancel).'
    });
  }

  if (args.name === 'grabMovieRelease') {
    if (pending.type !== 'movie_release_pick') {
      throw new ToolPolicyError({
        message: `${args.name} blocked: pending type ${pending.type}`,
        userMessage: 'Pick a movie release number first (or say cancel).'
      });
    }
    const ok = pending.items.some((i) => i.toolArgs.guid === guid);
    if (!ok) {
      throw new ToolPolicyError({
        message: `${args.name} blocked: guid not in pending list`,
        userMessage: 'That release choice is no longer available. Ask for releases again and pick a number.'
      });
    }
    clearPendingAction(args.telegramUserId);
    return;
  }

  // grabSeriesRelease
  const indexerId = (args.parsedArgs as { indexerId?: unknown } | null | undefined)?.indexerId;
  if (typeof indexerId !== 'number' || !Number.isFinite(indexerId) || indexerId <= 0) {
    throw new ToolPolicyError({
      message: `${args.name} blocked: missing/invalid indexerId`,
      userMessage: 'Pick a release number first (or say cancel).'
    });
  }
  if (pending.type !== 'series_release_pick' && pending.type !== 'episode_release_pick') {
    throw new ToolPolicyError({
      message: `${args.name} blocked: pending type ${pending.type}`,
      userMessage: 'Pick a series release number first (or say cancel).'
    });
  }
  const ok = pending.items.some((i) => i.toolArgs.guid === guid && i.toolArgs.indexerId === indexerId);
  if (!ok) {
    throw new ToolPolicyError({
      message: `${args.name} blocked: release not in pending list`,
      userMessage: 'That release choice is no longer available. Ask for releases again and pick a number.'
    });
  }
  clearPendingAction(args.telegramUserId);
}

export async function executeTool(args: {
  requestId: string;
  telegramUserId?: number;
  name: string;
  rawArguments: string;
  userText: string;
}): Promise<unknown> {
  if (!isToolName(args.name)) {
    throw new Error(`Invalid tool name: ${args.name}`);
  }
  const name: ToolName = args.name;
  const parsedArgs = parseToolArgumentsJson(args.rawArguments);
  switch (name) {
    case 'searchMovie':
      return await searchMovie(parsedArgs as { title: string }, { requestId: args.requestId });
    case 'addMovie': {
      const base = parsedArgs as { tmdbId: number; qualityProfileId?: number };
      const qualityProfileId =
        typeof base.qualityProfileId === 'number'
          ? base.qualityProfileId
          : await getRadarrQualityProfileIdFromText({
              requestId: args.requestId,
              userText: args.userText,
              ...(typeof args.telegramUserId === 'number' ? { telegramUserId: args.telegramUserId } : {})
            });
      return await addMovie(
        { tmdbId: base.tmdbId, qualityProfileId },
        { requestId: args.requestId }
      );
    }
    case 'searchSeries':
      return await searchSeries(parsedArgs as { title: string }, { requestId: args.requestId });
    case 'addSeries':
      return await addSeries(parsedArgs as { tvdbId: number }, { requestId: args.requestId });
    case 'checkAvailabilityInPlex':
      return await checkAvailabilityInPlex(parsedArgs as { title: string }, { requestId: args.requestId });
    case 'getSeriesEpisodeStats':
      return await getSeriesEpisodeStats(parsedArgs as { title: string }, { requestId: args.requestId });
    case 'checkMovieInRadarr':
      return await checkMovieInRadarr(parsedArgs as { title: string }, { requestId: args.requestId });
    case 'previewMovieReleases': {
      const res = await previewMovieReleases(parsedArgs as { tmdbId: number; limit: number }, { requestId: args.requestId });
      if (typeof args.telegramUserId === 'number') {
        const now = Date.now();
        setPendingAction(args.telegramUserId, {
          type: 'movie_release_pick',
          createdAtMs: now,
          expiresAtMs: now + 10 * 60_000,
          items: res.candidates.map((c) => ({
            label: `${c.title} | ${c.quality ?? 'unknown'} | S:${c.seeders ?? 0} L:${c.leechers ?? 0}`,
            toolName: 'grabMovieRelease',
            toolArgs: { guid: c.guid }
          }))
        });
      }
      return res;
    }
    case 'grabMovieRelease':
      requirePendingGrabAuthorization({
        telegramUserId: args.telegramUserId,
        name: 'grabMovieRelease',
        parsedArgs
      });
      return await grabMovieRelease(parsedArgs as { guid: string }, { requestId: args.requestId });
    case 'previewSeriesReleases': {
      const res = await previewSeriesReleases(parsedArgs as { seriesId: number; limit: number }, { requestId: args.requestId });
      if (typeof args.telegramUserId === 'number') {
        const items = pendingItemsFromSonarrCandidates(res.candidates);
        if (items.length > 0) {
          const now = Date.now();
          setPendingAction(args.telegramUserId, {
            type: 'series_release_pick',
            createdAtMs: now,
            expiresAtMs: now + 10 * 60_000,
            items
          });
        }
      }
      return res;
    }
    case 'resolveEpisodeInSonarr':
      return await resolveEpisodeInSonarr(
        parsedArgs as { seriesTitle: string; seasonNumber: number; episodeNumber: number },
        { requestId: args.requestId }
      );
    case 'previewEpisodeReleases': {
      const res = await previewEpisodeReleases(
        parsedArgs as { seriesId: number; episodeId: number; limit: number },
        { requestId: args.requestId }
      );
      if (typeof args.telegramUserId === 'number') {
        const items = pendingItemsFromSonarrCandidates(res.candidates);
        if (items.length > 0) {
          const now = Date.now();
          setPendingAction(args.telegramUserId, {
            type: 'episode_release_pick',
            createdAtMs: now,
            expiresAtMs: now + 10 * 60_000,
            items
          });
        }
      }
      return res;
    }
    case 'grabSeriesRelease':
      requirePendingGrabAuthorization({
        telegramUserId: args.telegramUserId,
        name: 'grabSeriesRelease',
        parsedArgs
      });
      return await grabSeriesRelease(parsedArgs as { guid: string; indexerId: number }, { requestId: args.requestId });
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}
