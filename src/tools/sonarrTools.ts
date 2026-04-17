import { z } from 'zod';
import { SonarrClient } from '../clients/sonarrClient.js';
import { logger } from '../config/logger.js';
import {
  HttpError,
  type AddSeriesResult,
  type GrabResult,
  type PreviewEpisodeReleasesResult,
  type PreviewSeriesReleasesResult,
  type ResolveEpisodeResult,
  type SearchSeriesResult,
  type SeriesEpisodeStatsResult
} from '../types/index.js';
import { buildReleaseRecommendation } from './releasePreviewMeta.js';
import { tmdbTvUrl, tvdbSeriesUrl } from '../util/externalLinks.js';
import {
  AddSeriesInputSchema,
  GetSeriesEpisodeStatsInputSchema,
  GrabSeriesReleaseInputSchema,
  PreviewEpisodeReleasesInputSchema,
  PreviewSeriesReleasesInputSchema,
  ResolveEpisodeInSonarrInputSchema,
  SearchSeriesInputSchema
} from '../agents/toolSchemas.js';

function pickRootFolderPath(rootFolders: Array<{ path: string }>): string {
  const first = rootFolders[0]?.path;
  if (!first) throw new Error('Sonarr has no root folders configured.');
  return first;
}

function pickDefaultQualityProfileId(profiles: Array<{ id: number; name: string }>): number {
  const preferred = profiles.find((p) => /hd-?1080p/i.test(p.name)) ?? profiles[0];
  if (!preferred) throw new Error('Sonarr has no quality profiles configured.');
  return preferred.id;
}

export async function searchSeries(
  input: z.infer<typeof SearchSeriesInputSchema>,
  ctx: { requestId: string }
): Promise<SearchSeriesResult> {
  const parsed = SearchSeriesInputSchema.parse(input);
  const log = logger.child({ tool: 'searchSeries', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { title: parsed.title });
    const client = new SonarrClient();
    const results = await client.lookupSeries(parsed.title);

    const matches = results
      .filter((r) => typeof r.tvdbId === 'number' && r.tvdbId > 0)
      .slice(0, 10)
      .map((r) => {
        const tmdbId =
          typeof r.tmdbId === 'number' && r.tmdbId > 0 ? r.tmdbId : null;
        return {
          title: r.title,
          year: typeof r.year === 'number' ? r.year : null,
          tvdbId: r.tvdbId,
          overview: typeof r.overview === 'string' && r.overview.trim().length > 0 ? r.overview : null,
          tmdbUrl: tmdbId !== null ? tmdbTvUrl(tmdbId) : null,
          tvdbUrl: tvdbSeriesUrl(r.tvdbId)
        };
      });

    log.info('tool.success', { elapsedMs: Date.now() - startedAt, matchCount: matches.length });
    return { matches };
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    const extra =
      err instanceof HttpError
        ? { status: err.status, url: err.url, method: err.method }
        : {};
    log.error('tool.error', { elapsedMs: Date.now() - startedAt, error: e.message, ...extra });
    throw err;
  }
}

export async function addSeries(
  input: z.infer<typeof AddSeriesInputSchema>,
  ctx: { requestId: string }
): Promise<AddSeriesResult> {
  const parsed = AddSeriesInputSchema.parse(input);
  const log = logger.child({ tool: 'addSeries', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { tvdbId: parsed.tvdbId });
    const client = new SonarrClient();

    const [rootFolders, qualityProfiles, lookup] = await Promise.all([
      client.getRootFolders(),
      client.getQualityProfiles(),
      client.lookupSeries(`tvdb:${parsed.tvdbId}`)
    ]);

    const series = lookup.find((s) => s.tvdbId === parsed.tvdbId) ?? lookup[0];
    if (!series) throw new Error(`Sonarr lookup failed for tvdbId=${parsed.tvdbId}`);

    const added = await client.addSeries({
      ...series,
      qualityProfileId: pickDefaultQualityProfileId(qualityProfiles),
      rootFolderPath: pickRootFolderPath(rootFolders),
      monitored: true,
      addOptions: { searchForMissingEpisodes: true }
    });

    const out: AddSeriesResult = {
      added: true,
      tvdbId: added.tvdbId,
      title: added.title,
      year: typeof added.year === 'number' ? added.year : null,
      sonarrId: added.id
    };

    log.info('tool.success', { elapsedMs: Date.now() - startedAt, sonarrId: out.sonarrId });
    return out;
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    const extra =
      err instanceof HttpError
        ? { status: err.status, url: err.url, method: err.method }
        : {};
    log.error('tool.error', { elapsedMs: Date.now() - startedAt, error: e.message, ...extra });
    throw err;
  }
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function getSeriesEpisodeStats(
  input: z.infer<typeof GetSeriesEpisodeStatsInputSchema>,
  ctx: { requestId: string }
): Promise<SeriesEpisodeStatsResult> {
  const parsed = GetSeriesEpisodeStatsInputSchema.parse(input);
  const log = logger.child({ tool: 'getSeriesEpisodeStats', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { title: parsed.title });
    const client = new SonarrClient();
    const series = await client.getSeries();

    const q = normalizeTitle(parsed.title);
    const best =
      series.find((s) => normalizeTitle(s.title) === q) ??
      series.find((s) => normalizeTitle(s.title).includes(q) || q.includes(normalizeTitle(s.title)));

    if (!best) {
      throw new Error(`Series not found in Sonarr: ${parsed.title}`);
    }

    const episodes = await client.getEpisodes(best.id);
    const totalEpisodes = episodes.length;
    const haveEpisodes = episodes.filter((e) => e.hasFile).length;
    const missingEpisodes = totalEpisodes - haveEpisodes;

    const bySeasonMap = new Map<number, { have: number; total: number }>();
    for (const ep of episodes) {
      const sn = ep.seasonNumber;
      const cur = bySeasonMap.get(sn) ?? { have: 0, total: 0 };
      cur.total += 1;
      if (ep.hasFile) cur.have += 1;
      bySeasonMap.set(sn, cur);
    }
    const bySeason = [...bySeasonMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, v]) => ({
        seasonNumber,
        haveEpisodes: v.have,
        totalEpisodes: v.total
      }));

    const owned = episodes
      .filter((e) => e.hasFile)
      .sort(
        (a, b) =>
          a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber
      );
    const seasonsWithOwnedEpisodes = [
      ...new Set(owned.map((e) => e.seasonNumber))
    ].sort((a, b) => a - b);

    /** Above this, omit per-episode list to keep tool output and replies manageable */
    const ownedListMax = 40;
    const ownedEpisodesList: SeriesEpisodeStatsResult['ownedEpisodesList'] =
      owned.length <= ownedListMax
        ? owned.map((e) => ({
            seasonNumber: e.seasonNumber,
            episodeNumber: e.episodeNumber
          }))
        : null;

    const out: SeriesEpisodeStatsResult = {
      seriesTitle: best.title,
      seriesId: best.id,
      totalEpisodes,
      haveEpisodes,
      missingEpisodes,
      bySeason,
      seasonsWithOwnedEpisodes,
      ownedEpisodesList
    };

    log.info('tool.success', { elapsedMs: Date.now() - startedAt, ...out });
    return out;
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    const extra =
      err instanceof HttpError
        ? { status: err.status, url: err.url, method: err.method }
        : {};
    log.error('tool.error', { elapsedMs: Date.now() - startedAt, error: e.message, ...extra });
    throw err;
  }
}

/**
 * Ensure the series exists in Sonarr so release preview can run (add without indexer search when new).
 */
export async function ensureSeriesInSonarrForPreview(args: {
  tvdbId: number;
  ctx: { requestId: string };
}): Promise<{ seriesId: number; added: boolean }> {
  const log = logger.child({ tool: 'ensureSeriesInSonarrForPreview', requestId: args.ctx.requestId });
  const client = new SonarrClient();
  const existing = (await client.getSeries()).find((s) => s.tvdbId === args.tvdbId);
  if (existing) {
    return { seriesId: existing.id, added: false };
  }

  const [rootFolders, qualityProfiles, lookup] = await Promise.all([
    client.getRootFolders(),
    client.getQualityProfiles(),
    client.lookupSeries(`tvdb:${args.tvdbId}`)
  ]);

  const series = lookup.find((s) => s.tvdbId === args.tvdbId) ?? lookup[0];
  if (!series) throw new Error(`Sonarr lookup failed for tvdbId=${args.tvdbId}`);

  const added = await client.addSeries({
    ...series,
    qualityProfileId: pickDefaultQualityProfileId(qualityProfiles),
    rootFolderPath: pickRootFolderPath(rootFolders),
    monitored: true,
    addOptions: { searchForMissingEpisodes: false }
  });

  log.info('preview.auto_added_series', { tvdbId: args.tvdbId, sonarrId: added.id });
  return { seriesId: added.id, added: true };
}

export async function previewSeriesReleases(
  input: z.infer<typeof PreviewSeriesReleasesInputSchema>,
  ctx: { requestId: string }
): Promise<PreviewSeriesReleasesResult> {
  const parsed = PreviewSeriesReleasesInputSchema.parse(input);
  const log = logger.child({ tool: 'previewSeriesReleases', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { seriesId: parsed.seriesId, limit: parsed.limit });
    const client = new SonarrClient();
    const releases = await client.getReleases({ seriesId: parsed.seriesId });

    const grabbable = releases.filter(
      (r) => typeof r.indexerId === 'number' && r.indexerId > 0
    );
    const candidates = grabbable
      .slice()
      .sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))
      .slice(0, parsed.limit)
      .map((r) => ({
        guid: r.guid,
        indexerId: r.indexerId as number,
        title: r.title,
        quality: r.quality?.quality?.name ?? null,
        seeders: typeof r.seeders === 'number' ? r.seeders : null,
        leechers: typeof r.leechers === 'number' ? r.leechers : null,
        sizeBytes: typeof r.size === 'number' ? r.size : null
      }));

    const out: PreviewSeriesReleasesResult = {
      seriesId: parsed.seriesId,
      candidates,
      ...buildReleaseRecommendation(candidates.length)
    };

    log.info('tool.success', { elapsedMs: Date.now() - startedAt, candidateCount: candidates.length });
    return out;
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    const extra =
      err instanceof HttpError
        ? { status: err.status, url: err.url, method: err.method }
        : {};
    log.error('tool.error', { elapsedMs: Date.now() - startedAt, error: e.message, ...extra });
    throw err;
  }
}

export async function grabSeriesRelease(
  input: z.infer<typeof GrabSeriesReleaseInputSchema>,
  ctx: { requestId: string }
): Promise<GrabResult> {
  const parsed = GrabSeriesReleaseInputSchema.parse(input);
  const log = logger.child({ tool: 'grabSeriesRelease', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { guid: parsed.guid, indexerId: parsed.indexerId });
    const client = new SonarrClient();
    await client.grabRelease({ guid: parsed.guid, indexerId: parsed.indexerId });
    const out: GrabResult = { grabbed: true, title: parsed.guid };
    log.info('tool.success', { elapsedMs: Date.now() - startedAt });
    return out;
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    const extra =
      err instanceof HttpError
        ? { status: err.status, url: err.url, method: err.method }
        : {};
    log.error('tool.error', { elapsedMs: Date.now() - startedAt, error: e.message, ...extra });
    throw err;
  }
}

export async function resolveEpisodeInSonarr(
  input: z.infer<typeof ResolveEpisodeInSonarrInputSchema>,
  ctx: { requestId: string }
): Promise<ResolveEpisodeResult> {
  const parsed = ResolveEpisodeInSonarrInputSchema.parse(input);
  const log = logger.child({ tool: 'resolveEpisodeInSonarr', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { seriesTitle: parsed.seriesTitle, seasonNumber: parsed.seasonNumber, episodeNumber: parsed.episodeNumber });
    const client = new SonarrClient();
    const series = await client.getSeries();
    const q = normalizeTitle(parsed.seriesTitle);
    const best =
      series.find((s) => normalizeTitle(s.title) === q) ??
      series.find((s) => normalizeTitle(s.title).includes(q) || q.includes(normalizeTitle(s.title)));
    if (!best) throw new Error(`Series not found in Sonarr: ${parsed.seriesTitle}`);

    const episodes = await client.getEpisodes(best.id);
    const ep = episodes.find(
      (e) => e.seasonNumber === parsed.seasonNumber && e.episodeNumber === parsed.episodeNumber
    );
    if (!ep) throw new Error(`Episode not found in Sonarr: ${best.title} S${parsed.seasonNumber}E${parsed.episodeNumber}`);

    const out: ResolveEpisodeResult = {
      seriesId: best.id,
      seriesTitle: best.title,
      seasonNumber: parsed.seasonNumber,
      episodeNumber: parsed.episodeNumber,
      episodeId: ep.id,
      episodeTitle: ep.title
    };

    log.info('tool.success', { elapsedMs: Date.now() - startedAt, ...out });
    return out;
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    const extra =
      err instanceof HttpError
        ? { status: err.status, url: err.url, method: err.method }
        : {};
    log.error('tool.error', { elapsedMs: Date.now() - startedAt, error: e.message, ...extra });
    throw err;
  }
}

export async function previewEpisodeReleases(
  input: z.infer<typeof PreviewEpisodeReleasesInputSchema>,
  ctx: { requestId: string }
): Promise<PreviewEpisodeReleasesResult> {
  const parsed = PreviewEpisodeReleasesInputSchema.parse(input);
  const log = logger.child({ tool: 'previewEpisodeReleases', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { seriesId: parsed.seriesId, episodeId: parsed.episodeId, limit: parsed.limit });
    const client = new SonarrClient();
    const releases = await client.getReleases({ seriesId: parsed.seriesId, episodeId: parsed.episodeId });

    const grabbable = releases.filter(
      (r) => typeof r.indexerId === 'number' && r.indexerId > 0
    );
    const candidates = grabbable
      .slice()
      .sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))
      .slice(0, parsed.limit)
      .map((r) => ({
        guid: r.guid,
        indexerId: r.indexerId as number,
        title: r.title,
        quality: r.quality?.quality?.name ?? null,
        seeders: typeof r.seeders === 'number' ? r.seeders : null,
        leechers: typeof r.leechers === 'number' ? r.leechers : null,
        sizeBytes: typeof r.size === 'number' ? r.size : null
      }));

    const out: PreviewEpisodeReleasesResult = {
      seriesId: parsed.seriesId,
      episodeId: parsed.episodeId,
      candidates,
      ...buildReleaseRecommendation(candidates.length)
    };

    log.info('tool.success', { elapsedMs: Date.now() - startedAt, candidateCount: candidates.length });
    return out;
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    const extra =
      err instanceof HttpError
        ? { status: err.status, url: err.url, method: err.method }
        : {};
    log.error('tool.error', { elapsedMs: Date.now() - startedAt, error: e.message, ...extra });
    throw err;
  }
}

