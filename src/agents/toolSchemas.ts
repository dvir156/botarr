import { z } from 'zod';

export const SearchMovieInputSchema = z.object({
  title: z.string().trim().min(1)
});

export const AddMovieInputSchema = z.object({
  tmdbId: z.number().int().positive(),
  qualityProfileId: z.number().int().positive()
});

export const SearchSeriesInputSchema = z.object({
  title: z.string().trim().min(1)
});

export const AddSeriesInputSchema = z.object({
  tvdbId: z.number().int().positive()
});

export const CheckAvailabilityInPlexInputSchema = z.object({
  title: z.string().trim().min(1)
});

export const GetSeriesEpisodeStatsInputSchema = z.object({
  title: z.string().trim().min(1)
});

export const CheckMovieInRadarrInputSchema = z.object({
  title: z.string().trim().min(1)
});

export const PreviewMovieReleasesInputSchema = z.object({
  tmdbId: z.number().int().positive(),
  limit: z.number().int().positive().max(20).optional().default(5)
});

export const GrabMovieReleaseInputSchema = z.object({
  guid: z.string().min(1)
});

export const PreviewSeriesReleasesInputSchema = z.object({
  seriesId: z.number().int().positive(),
  limit: z.number().int().positive().max(20).optional().default(5)
});

export const GrabSeriesReleaseInputSchema = z.object({
  guid: z.string().min(1),
  indexerId: z.number().int().positive()
});

export const ResolveEpisodeInSonarrInputSchema = z.object({
  seriesTitle: z.string().trim().min(1),
  seasonNumber: z.number().int().positive(),
  episodeNumber: z.number().int().positive()
});

export const PreviewEpisodeReleasesInputSchema = z.object({
  seriesId: z.number().int().positive(),
  episodeId: z.number().int().positive(),
  limit: z.number().int().positive().max(20).optional().default(5)
});

