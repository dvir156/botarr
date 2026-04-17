import { z } from 'zod';
import { RadarrClient } from '../clients/radarrClient.js';
import { logger } from '../config/logger.js';
import {
  HttpError,
  type AddMovieResult,
  type GrabResult,
  type PreviewMovieReleasesResult,
  type RadarrMovieStatusResult,
  type SearchMovieResult
} from '../types/index.js';
import { buildReleaseRecommendation } from './releasePreviewMeta.js';
import { tmdbMovieUrl } from '../util/externalLinks.js';
import {
  AddMovieInputSchema,
  CheckMovieInRadarrInputSchema,
  GrabMovieReleaseInputSchema,
  PreviewMovieReleasesInputSchema,
  SearchMovieInputSchema
} from '../agents/toolSchemas.js';

function pickRootFolderPath(rootFolders: Array<{ path: string }>): string {
  const first = rootFolders[0]?.path;
  if (!first) throw new Error('Radarr has no root folders configured.');
  return first;
}

function pickDefaultMovieQualityProfileId(
  profiles: Array<{ id: number; name: string }>
): number {
  const preferred = profiles.find((p) => /hd-?1080p/i.test(p.name)) ?? profiles[0];
  if (!preferred) throw new Error('Radarr has no quality profiles configured.');
  return preferred.id;
}

/**
 * Radarr release API needs a library movieId. If the title is not in Radarr yet, add it
 * without triggering a search so the user can still choose a release from the preview list.
 */
async function ensureMovieInRadarrForPreview(args: {
  client: RadarrClient;
  tmdbId: number;
  log: ReturnType<typeof logger.child>;
}): Promise<{ movieId: number; added: boolean }> {
  const movies = await args.client.getMovies();
  const existing = movies.find((m) => m.tmdbId === args.tmdbId);
  if (existing) {
    return { movieId: existing.id, added: false };
  }

  const [rootFolders, profiles, lookup] = await Promise.all([
    args.client.getRootFolders(),
    args.client.getQualityProfiles(),
    args.client.lookupMovie(`tmdb:${args.tmdbId}`)
  ]);

  const movie = lookup.find((m) => m.tmdbId === args.tmdbId) ?? lookup[0];
  if (!movie) throw new Error(`Radarr lookup failed for tmdbId=${args.tmdbId}`);

  const added = await args.client.addMovie({
    ...movie,
    qualityProfileId: pickDefaultMovieQualityProfileId(profiles),
    rootFolderPath: pickRootFolderPath(rootFolders),
    monitored: true,
    addOptions: { searchForMovie: false }
  });

  args.log.info('preview.auto_added_movie', { tmdbId: args.tmdbId, radarrId: added.id });
  return { movieId: added.id, added: true };
}

export async function searchMovie(
  input: z.infer<typeof SearchMovieInputSchema>,
  ctx: { requestId: string }
): Promise<SearchMovieResult> {
  const parsed = SearchMovieInputSchema.parse(input);
  const log = logger.child({ tool: 'searchMovie', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { title: parsed.title });
    const client = new RadarrClient();
    const results = await client.lookupMovie(parsed.title);

    const matches = results
      .filter((r) => typeof r.tmdbId === 'number' && r.tmdbId > 0)
      .slice(0, 10)
      .map((r) => ({
        title: r.title,
        year: typeof r.year === 'number' ? r.year : null,
        tmdbId: r.tmdbId,
        overview: typeof r.overview === 'string' && r.overview.trim().length > 0 ? r.overview : null,
        tmdbUrl: tmdbMovieUrl(r.tmdbId)
      }));

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

export async function addMovie(
  input: z.infer<typeof AddMovieInputSchema>,
  ctx: { requestId: string }
): Promise<AddMovieResult> {
  const parsed = AddMovieInputSchema.parse(input);
  const log = logger.child({ tool: 'addMovie', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { tmdbId: parsed.tmdbId, qualityProfileId: parsed.qualityProfileId });
    const client = new RadarrClient();

    const [rootFolders, lookup] = await Promise.all([
      client.getRootFolders(),
      client.lookupMovie(`tmdb:${parsed.tmdbId}`)
    ]);

    const movie = lookup.find((m) => m.tmdbId === parsed.tmdbId) ?? lookup[0];
    if (!movie) throw new Error(`Radarr lookup failed for tmdbId=${parsed.tmdbId}`);

    const added = await client.addMovie({
      ...movie,
      qualityProfileId: parsed.qualityProfileId,
      rootFolderPath: pickRootFolderPath(rootFolders),
      monitored: true,
      addOptions: { searchForMovie: true }
    });

    const out: AddMovieResult = {
      added: true,
      tmdbId: added.tmdbId,
      title: added.title,
      year: typeof added.year === 'number' ? added.year : null,
      radarrId: added.id,
      qualityProfileId: parsed.qualityProfileId
    };

    log.info('tool.success', { elapsedMs: Date.now() - startedAt, radarrId: out.radarrId });
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

export async function checkMovieInRadarr(
  input: z.infer<typeof CheckMovieInRadarrInputSchema>,
  ctx: { requestId: string }
): Promise<RadarrMovieStatusResult> {
  const parsed = CheckMovieInRadarrInputSchema.parse(input);
  const log = logger.child({ tool: 'checkMovieInRadarr', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { title: parsed.title });
    const client = new RadarrClient();
    const movies = await client.getMovies();

    const q = normalizeTitle(parsed.title);
    const best =
      movies.find((m) => normalizeTitle(m.title) === q) ??
      movies.find((m) => normalizeTitle(m.title).includes(q) || q.includes(normalizeTitle(m.title)));

    const out: RadarrMovieStatusResult = best
      ? {
          query: parsed.title,
          inRadarr: true,
          hasFile: Boolean(best.hasFile),
          title: best.title,
          year: typeof best.year === 'number' ? best.year : null,
          tmdbId: best.tmdbId,
        }
      : {
          query: parsed.title,
          inRadarr: false,
          hasFile: false,
          title: null,
          year: null,
          tmdbId: null
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

export async function previewMovieReleases(
  input: z.infer<typeof PreviewMovieReleasesInputSchema>,
  ctx: { requestId: string }
): Promise<PreviewMovieReleasesResult> {
  const parsed = PreviewMovieReleasesInputSchema.parse(input);
  const log = logger.child({ tool: 'previewMovieReleases', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { tmdbId: parsed.tmdbId, limit: parsed.limit });
    const client = new RadarrClient();

    const { movieId, added } = await ensureMovieInRadarrForPreview({
      client,
      tmdbId: parsed.tmdbId,
      log
    });

    const releases = await client.getReleases(movieId);

    const candidates = releases
      .slice()
      .sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))
      .slice(0, parsed.limit)
      .map((r) => ({
        guid: r.guid,
        indexerId:
          typeof r.indexerId === 'number' && Number.isFinite(r.indexerId) && r.indexerId > 0
            ? r.indexerId
            : null,
        title: r.title,
        quality: r.quality?.quality?.name ?? null,
        seeders: typeof r.seeders === 'number' ? r.seeders : null,
        leechers: typeof r.leechers === 'number' ? r.leechers : null,
        sizeBytes: typeof r.size === 'number' ? r.size : null
      }));

    const out: PreviewMovieReleasesResult = {
      movieId,
      tmdbId: parsed.tmdbId,
      ...(added ? { addedToRadarr: true } : {}),
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

export async function grabMovieRelease(
  input: z.infer<typeof GrabMovieReleaseInputSchema>,
  ctx: { requestId: string }
): Promise<GrabResult> {
  const parsed = GrabMovieReleaseInputSchema.parse(input);
  const log = logger.child({ tool: 'grabMovieRelease', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { guid: parsed.guid, indexerId: parsed.indexerId });
    const client = new RadarrClient();
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

