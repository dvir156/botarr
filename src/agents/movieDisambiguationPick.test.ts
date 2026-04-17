import { describe, expect, it } from 'vitest';
import {
  looksLikeMovieSearchList,
  looksLikeSeriesSearchList,
  parseMovieSearchListItems,
  parseSeriesSearchListItems,
  parseTmdbIdFromListByTitleHint,
  parseTmdbIdFromNumberedMovieList
} from './movieDisambiguationPick.js';

const sampleList = `Here are some movies found:

1. Thunderbolts (2025) - https://www.themoviedb.org/movie/986056
2. Thunderbolts and Lightning Strikes (2019) - https://www.themoviedb.org/movie/624653`;

const sampleSeriesList = `Pick a show:

1. Example A (2020) - https://www.thetvdb.com/?tab=series&id=111
2. Example B (2018) - https://www.thetvdb.com/?tab=series&id=222`;

describe('parseTmdbIdFromNumberedMovieList', () => {
  it('returns tmdb id for matching line', () => {
    expect(parseTmdbIdFromNumberedMovieList(sampleList, 1)).toBe(986056);
    expect(parseTmdbIdFromNumberedMovieList(sampleList, 2)).toBe(624653);
  });

  it('returns null when choice out of range', () => {
    expect(parseTmdbIdFromNumberedMovieList(sampleList, 99)).toBe(null);
  });
});

describe('looksLikeMovieSearchList', () => {
  it('is true when at least two TMDB movie links appear', () => {
    expect(looksLikeMovieSearchList(sampleList)).toBe(true);
  });

  it('is false for a single link or no links', () => {
    expect(looksLikeMovieSearchList('One: https://www.themoviedb.org/movie/1')).toBe(false);
    expect(looksLikeMovieSearchList('no urls')).toBe(false);
  });
});

describe('parseMovieSearchListItems', () => {
  it('extracts tmdb ids and labels from numbered rows', () => {
    expect(parseMovieSearchListItems(sampleList)).toEqual([
      { tmdbId: 986056, label: 'Thunderbolts (2025)' },
      { tmdbId: 624653, label: 'Thunderbolts and Lightning Strikes (2019)' }
    ]);
  });
});

describe('looksLikeSeriesSearchList', () => {
  it('is true when at least two TVDB series links appear', () => {
    expect(looksLikeSeriesSearchList(sampleSeriesList)).toBe(true);
  });

  it('is false for a single TVDB link', () => {
    expect(looksLikeSeriesSearchList('One https://www.thetvdb.com/?tab=series&id=1')).toBe(false);
  });
});

describe('parseSeriesSearchListItems', () => {
  it('extracts tvdb ids and labels', () => {
    expect(parseSeriesSearchListItems(sampleSeriesList)).toEqual([
      { tvdbId: 111, label: 'Example A (2020)' },
      { tvdbId: 222, label: 'Example B (2018)' }
    ]);
  });
});

describe('parseTmdbIdFromListByTitleHint', () => {
  it('matches Thunderbolts (2025) to the first row', () => {
    expect(parseTmdbIdFromListByTitleHint(sampleList, 'Thunderbolts (2025)')).toBe(986056);
  });

  it('matches partial title when unique', () => {
    expect(parseTmdbIdFromListByTitleHint(sampleList, 'Lightning Strikes 2019')).toBe(624653);
  });

  it('returns null on ambiguous short input', () => {
    expect(parseTmdbIdFromListByTitleHint(sampleList, 'Thunderbolts')).toBe(null);
  });
});
