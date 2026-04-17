import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { getRadarrEnv } from '../config/env.js';
import { HttpError, type HttpMethod } from '../types/index.js';

export type RadarrRootFolder = {
  id: number;
  path: string;
};

export type RadarrQualityProfile = {
  id: number;
  name: string;
};

export type RadarrMovieLookup = {
  title: string;
  year?: number;
  tmdbId: number;
  titleSlug?: string;
  images?: Array<{ coverType?: string; url?: string; remoteUrl?: string }>;
  overview?: string;
};

export type RadarrAddMovieRequest = RadarrMovieLookup & {
  qualityProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  addOptions: {
    searchForMovie: boolean;
  };
};

export type RadarrMovie = {
  id: number;
  title: string;
  year?: number;
  tmdbId: number;
};

export type RadarrMovieInLibrary = RadarrMovie & {
  hasFile?: boolean;
  movieFile?: unknown;
};

export type RadarrRelease = {
  guid: string;
  title: string;
  indexerId?: number;
  indexer?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  quality?: { quality?: { name?: string } };
};

function toHttpError(args: {
  err: unknown;
  method: HttpMethod;
  url: string;
}): HttpError {
  if (axios.isAxiosError(args.err)) {
    const status = args.err.response?.status ?? null;
    const body = args.err.response?.data ?? null;
    return new HttpError({
      message: `HTTP ${args.method} ${args.url} failed`,
      status,
      method: args.method,
      url: args.url,
      responseBody: body
    });
  }
  return new HttpError({
    message: `HTTP ${args.method} ${args.url} failed`,
    status: null,
    method: args.method,
    url: args.url,
    responseBody: null
  });
}

export class RadarrClient {
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;

  constructor() {
    const env = getRadarrEnv();
    this.baseUrl = env.RADARR_URL;
    this.http = axios.create({
      baseURL: env.RADARR_URL,
      headers: {
        'X-Api-Key': env.RADARR_API_KEY
      },
      timeout: 20_000
    });
  }

  async lookupMovie(term: string): Promise<RadarrMovieLookup[]> {
    const url = `${this.baseUrl}/api/v3/movie/lookup`;
    try {
      const res: AxiosResponse<RadarrMovieLookup[]> = await this.http.get(
        '/api/v3/movie/lookup',
        { params: { term } }
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async addMovie(req: RadarrAddMovieRequest): Promise<RadarrMovie> {
    const url = `${this.baseUrl}/api/v3/movie`;
    try {
      const res: AxiosResponse<RadarrMovie> = await this.http.post(
        '/api/v3/movie',
        req
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'POST', url });
    }
  }

  async getMovies(): Promise<RadarrMovieInLibrary[]> {
    const url = `${this.baseUrl}/api/v3/movie`;
    try {
      const res: AxiosResponse<RadarrMovieInLibrary[]> = await this.http.get('/api/v3/movie');
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async getRootFolders(): Promise<RadarrRootFolder[]> {
    const url = `${this.baseUrl}/api/v3/rootfolder`;
    try {
      const res: AxiosResponse<RadarrRootFolder[]> = await this.http.get(
        '/api/v3/rootfolder'
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async getQualityProfiles(): Promise<RadarrQualityProfile[]> {
    const url = `${this.baseUrl}/api/v3/qualityprofile`;
    try {
      const res: AxiosResponse<RadarrQualityProfile[]> = await this.http.get(
        '/api/v3/qualityprofile'
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async getReleases(movieId: number): Promise<RadarrRelease[]> {
    const url = `${this.baseUrl}/api/v3/release`;
    try {
      const res: AxiosResponse<RadarrRelease[]> = await this.http.get('/api/v3/release', {
        params: { movieId }
      });
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async grabRelease(args: { guid: string; indexerId: number }): Promise<void> {
    const url = `${this.baseUrl}/api/v3/release`;
    try {
      await this.http.post('/api/v3/release', { guid: args.guid, indexerId: args.indexerId });
    } catch (err) {
      throw toHttpError({ err, method: 'POST', url });
    }
  }
}

