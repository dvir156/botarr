import { z } from 'zod';
import type { JsonObject, OpenAiToolDefinition } from '../types/index.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AddMovieInputSchema,
  AddSeriesInputSchema,
  CheckAvailabilityInPlexInputSchema,
  CheckMovieInRadarrInputSchema,
  GetSeriesEpisodeStatsInputSchema,
  GrabMovieReleaseInputSchema,
  GrabSeriesReleaseInputSchema,
  PreviewEpisodeReleasesInputSchema,
  PreviewMovieReleasesInputSchema,
  PreviewSeriesReleasesInputSchema,
  ResolveEpisodeInSonarrInputSchema,
  SearchMovieInputSchema,
  SearchSeriesInputSchema
} from './toolSchemas.js';

function toOpenAiParameters(schema: z.ZodTypeAny): JsonObject {
  // zod-to-json-schema’s types lag behind Zod v4; runtime works fine with a cast.
  const jsonSchema = zodToJsonSchema(schema as any, {
    $refStrategy: 'none',
    target: 'jsonSchema7'
  });
  // zod-to-json-schema returns { $schema, schema, definitions? }. OpenAI expects just the schema root.
  return ((jsonSchema as { schema?: unknown }).schema ?? {}) as JsonObject;
}

export const toolDefinitions: OpenAiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'searchMovie',
      description:
        'Search Radarr (TMDB) for a movie by title. Use whenever the user wants a movie and the title may match more than one film, or before add/preview.',
      parameters: toOpenAiParameters(SearchMovieInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'addMovie',
      description:
        'Add a movie to Radarr by tmdbId using a specific qualityProfileId. Always check Plex first to avoid duplicates.',
      parameters: toOpenAiParameters(AddMovieInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'searchSeries',
      description:
        'Search Sonarr for a series by title. Use when the show name may match multiple series or before add/preview.',
      parameters: toOpenAiParameters(SearchSeriesInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'addSeries',
      description:
        'Add a series to Sonarr by tvdbId with monitored=true and auto-search for missing episodes. Always check Plex first.',
      parameters: toOpenAiParameters(AddSeriesInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'checkAvailabilityInPlex',
      description: 'Check whether a title already exists in Plex.',
      parameters: toOpenAiParameters(CheckAvailabilityInPlexInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'getSeriesEpisodeStats',
      description:
        'Get episode inventory for a series in Sonarr: totals, per-season counts, seasonsWithOwnedEpisodes, and ownedEpisodesList (each S+E when the library is small). Use for “what do I have”, “which episodes”, and “which seasons”.',
      parameters: toOpenAiParameters(GetSeriesEpisodeStatsInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'checkMovieInRadarr',
      description: 'Check whether a movie exists in Radarr (and whether it has a file) by title.',
      parameters: toOpenAiParameters(CheckMovieInRadarrInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'previewMovieReleases',
      description:
        'Preview movie releases from Radarr before grabbing. If the movie is not in Radarr yet, it is added automatically (addedToRadarr in the result) using a default quality profile, without starting a download until the user picks a release.',
      parameters: toOpenAiParameters(PreviewMovieReleasesInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'grabMovieRelease',
      description: 'Grab an exact movie release in Radarr by release guid.',
      parameters: toOpenAiParameters(GrabMovieReleaseInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'previewSeriesReleases',
      description: 'Preview series releases from Sonarr (seeders/leechers/quality) before grabbing.',
      parameters: toOpenAiParameters(PreviewSeriesReleasesInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'grabSeriesRelease',
      description: 'Grab an exact series release in Sonarr by guid and indexerId.',
      parameters: toOpenAiParameters(GrabSeriesReleaseInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'resolveEpisodeInSonarr',
      description: 'Resolve an episode (series title + season/episode numbers) to Sonarr episodeId.',
      parameters: toOpenAiParameters(ResolveEpisodeInSonarrInputSchema)
    }
  },
  {
    type: 'function',
    function: {
      name: 'previewEpisodeReleases',
      description: 'Preview releases for a specific episode in Sonarr (seeders/leechers/quality).',
      parameters: toOpenAiParameters(PreviewEpisodeReleasesInputSchema)
    }
  }
];
