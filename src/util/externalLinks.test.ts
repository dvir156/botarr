import { describe, expect, it } from 'vitest';
import { tmdbMovieUrl, tmdbTvUrl, tvdbSeriesUrl } from './externalLinks.js';

describe('externalLinks', () => {
  it('builds TMDB movie and TV URLs', () => {
    expect(tmdbMovieUrl(123)).toBe('https://www.themoviedb.org/movie/123');
    expect(tmdbTvUrl(456)).toBe('https://www.themoviedb.org/tv/456');
  });

  it('builds TVDB series URL', () => {
    expect(tvdbSeriesUrl(789)).toBe('https://www.thetvdb.com/?tab=series&id=789');
  });
});
