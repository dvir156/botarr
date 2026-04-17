/** [The Movie Database](https://www.themoviedb.org/) — movie pages use TMDB id. */
export function tmdbMovieUrl(tmdbId: number): string {
  return `https://www.themoviedb.org/movie/${tmdbId}`;
}

/** TMDB TV series pages use TMDB’s TV id (not TVDB). */
export function tmdbTvUrl(tmdbTvId: number): string {
  return `https://www.themoviedb.org/tv/${tmdbTvId}`;
}

/** TheTVDB series page when TMDB TV link is unavailable. */
export function tvdbSeriesUrl(tvdbId: number): string {
  return `https://www.thetvdb.com/?tab=series&id=${tvdbId}`;
}
