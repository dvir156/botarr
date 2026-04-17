export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export type ToolName =
  | 'searchMovie'
  | 'addMovie'
  | 'searchSeries'
  | 'addSeries'
  | 'checkAvailabilityInPlex'
  | 'getSeriesEpisodeStats'
  | 'checkMovieInRadarr'
  | 'previewMovieReleases'
  | 'grabMovieRelease'
  | 'previewSeriesReleases'
  | 'grabSeriesRelease'
  | 'resolveEpisodeInSonarr'
  | 'previewEpisodeReleases';

const TOOL_NAME_SET: ReadonlySet<string> = new Set<string>([
  'searchMovie',
  'addMovie',
  'searchSeries',
  'addSeries',
  'checkAvailabilityInPlex',
  'getSeriesEpisodeStats',
  'checkMovieInRadarr',
  'previewMovieReleases',
  'grabMovieRelease',
  'previewSeriesReleases',
  'grabSeriesRelease',
  'resolveEpisodeInSonarr',
  'previewEpisodeReleases'
]);

export function isToolName(name: string): name is ToolName {
  return TOOL_NAME_SET.has(name);
}

export type ToolCallLogContext = {
  tool: ToolName;
  requestId: string;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class HttpError extends Error {
  public readonly status: number | null;
  public readonly method: HttpMethod;
  public readonly url: string;
  public readonly responseBody: unknown;

  constructor(args: {
    message: string;
    status: number | null;
    method: HttpMethod;
    url: string;
    responseBody: unknown;
  }) {
    super(args.message);
    this.name = 'HttpError';
    this.status = args.status;
    this.method = args.method;
    this.url = args.url;
    this.responseBody = args.responseBody;
  }
}

/** Tool-call blocked by a hard application policy (non-LLM safeguard). */
export class ToolPolicyError extends Error {
  public readonly userMessage: string;

  constructor(args: { message: string; userMessage: string }) {
    super(args.message);
    this.name = 'ToolPolicyError';
    this.userMessage = args.userMessage;
  }
}

export function isToolPolicyError(err: unknown): err is ToolPolicyError {
  return err instanceof ToolPolicyError;
}

export type SearchMovieResult = {
  matches: Array<{
    title: string;
    year: number | null;
    tmdbId: number;
    overview: string | null;
    tmdbUrl: string;
  }>;
};

export type AddMovieResult = {
  added: boolean;
  tmdbId: number;
  title: string;
  year: number | null;
  radarrId: number;
  qualityProfileId: number;
};

export type SearchSeriesResult = {
  matches: Array<{
    title: string;
    year: number | null;
    tvdbId: number;
    overview: string | null;
    /** TMDB tv/{id} when Sonarr returns tmdbId; otherwise null. */
    tmdbUrl: string | null;
    /** Always present for TVDB-backed series. */
    tvdbUrl: string;
  }>;
};

export type AddSeriesResult = {
  added: boolean;
  tvdbId: number;
  title: string;
  year: number | null;
  sonarrId: number;
};

export type PlexAvailabilityResult = {
  available: boolean;
  matches: Array<{
    title: string;
    year: number | null;
    type: 'movie' | 'show' | 'episode' | 'artist' | 'album' | 'track' | 'unknown';
  }>;
  /** True when Plex env vars are unset; duplicate check was skipped. */
  plexNotConfigured?: boolean;
};

export type SeriesEpisodeStatsResult = {
  seriesTitle: string;
  seriesId: number;
  totalEpisodes: number;
  haveEpisodes: number;
  missingEpisodes: number;
  /** Per-season: episode count with files / total in Sonarr for that season */
  bySeason: Array<{
    seasonNumber: number;
    haveEpisodes: number;
    totalEpisodes: number;
  }>;
  /** Sorted season numbers that have at least one downloaded episode (for short summaries) */
  seasonsWithOwnedEpisodes: number[];
  /**
   * When haveEpisodes is not too large, each owned episode (season + episode number).
   * Omitted when there are many files so the reply should summarize by season instead.
   */
  ownedEpisodesList: Array<{ seasonNumber: number; episodeNumber: number }> | null;
};

export type RadarrMovieStatusResult = {
  query: string;
  inRadarr: boolean;
  hasFile: boolean;
  title: string | null;
  year: number | null;
  tmdbId: number | null;
};

export type ReleaseCandidate = {
  title: string;
  quality: string | null;
  seeders: number | null;
  leechers: number | null;
  sizeBytes: number | null;
};

/** Shown with release previews: list is sorted by seeders (highest first), so this is usually 1 */
export type ReleasePreviewRecommendation = {
  recommendedChoice: number | null;
  recommendationHint: string;
};

export type PreviewMovieReleasesResult = ReleasePreviewRecommendation & {
  movieId: number;
  tmdbId: number;
  /** True if the movie was just added to Radarr so releases could be listed. */
  addedToRadarr?: boolean;
  candidates: Array<
    ReleaseCandidate & {
      guid: string;
    }
  >;
};

export type PreviewSeriesReleasesResult = ReleasePreviewRecommendation & {
  seriesId: number;
  candidates: Array<
    ReleaseCandidate & {
      guid: string;
      indexerId: number | null;
    }
  >;
};

export type GrabResult = {
  grabbed: boolean;
  title: string;
};

export type ResolveEpisodeResult = {
  seriesId: number;
  seriesTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeId: number;
  episodeTitle: string;
};

export type PreviewEpisodeReleasesResult = ReleasePreviewRecommendation & {
  seriesId: number;
  episodeId: number;
  candidates: Array<
    ReleaseCandidate & {
      guid: string;
      indexerId: number | null;
    }
  >;
};

export type OpenAiToolDefinition = {
  type: 'function';
  function: {
    name: ToolName;
    description: string;
    parameters: JsonObject;
  };
};

export type OpenAiFunctionCall = {
  type: 'function_call';
  call_id: string;
  name: ToolName;
  arguments: string;
};

export type OpenAiMessageOutput = {
  type: 'message';
  id?: string;
  role?: 'assistant';
  content?: Array<{ type: 'output_text'; text: string }>;
};

export type OpenAiResponse = {
  id: string;
  output: Array<OpenAiFunctionCall | OpenAiMessageOutput | { type: string }>;
};

export type MediaAgentResponse = { replyText: string };

