import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { getSonarrEnv } from '../config/env.js';
import { HttpError, type HttpMethod } from '../types/index.js';

export type SonarrRootFolder = {
  id: number;
  path: string;
};

export type SonarrQualityProfile = {
  id: number;
  name: string;
};

export type SonarrSeriesLookup = {
  title: string;
  year?: number;
  tvdbId: number;
  /** Present on many Sonarr lookup responses; used for TMDB links. */
  tmdbId?: number;
  titleSlug?: string;
  images?: Array<{ coverType?: string; url?: string; remoteUrl?: string }>;
  overview?: string;
};

export type SonarrAddSeriesRequest = SonarrSeriesLookup & {
  qualityProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  addOptions: {
    searchForMissingEpisodes: boolean;
  };
};

export type SonarrSeries = {
  id: number;
  title: string;
  year?: number;
  tvdbId: number;
};

export type SonarrEpisode = {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  hasFile: boolean;
  episodeFileId?: number;
};

export type SonarrRelease = {
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

export class SonarrClient {
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;

  constructor() {
    const env = getSonarrEnv();
    this.baseUrl = env.SONARR_URL;
    this.http = axios.create({
      baseURL: env.SONARR_URL,
      headers: {
        'X-Api-Key': env.SONARR_API_KEY
      },
      timeout: 20_000
    });
  }

  async lookupSeries(term: string): Promise<SonarrSeriesLookup[]> {
    const url = `${this.baseUrl}/api/v3/series/lookup`;
    try {
      const res: AxiosResponse<SonarrSeriesLookup[]> = await this.http.get(
        '/api/v3/series/lookup',
        { params: { term } }
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async addSeries(req: SonarrAddSeriesRequest): Promise<SonarrSeries> {
    const url = `${this.baseUrl}/api/v3/series`;
    try {
      const res: AxiosResponse<SonarrSeries> = await this.http.post(
        '/api/v3/series',
        req
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'POST', url });
    }
  }

  async getSeries(): Promise<SonarrSeries[]> {
    const url = `${this.baseUrl}/api/v3/series`;
    try {
      const res: AxiosResponse<SonarrSeries[]> = await this.http.get('/api/v3/series');
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async getEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
    const url = `${this.baseUrl}/api/v3/episode`;
    try {
      const res: AxiosResponse<SonarrEpisode[]> = await this.http.get('/api/v3/episode', {
        params: { seriesId }
      });
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async getRootFolders(): Promise<SonarrRootFolder[]> {
    const url = `${this.baseUrl}/api/v3/rootfolder`;
    try {
      const res: AxiosResponse<SonarrRootFolder[]> = await this.http.get(
        '/api/v3/rootfolder'
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async getQualityProfiles(): Promise<SonarrQualityProfile[]> {
    const url = `${this.baseUrl}/api/v3/qualityprofile`;
    try {
      const res: AxiosResponse<SonarrQualityProfile[]> = await this.http.get(
        '/api/v3/qualityprofile'
      );
      return res.data;
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async getReleases(args: { seriesId: number; episodeId?: number }): Promise<SonarrRelease[]> {
    const url = `${this.baseUrl}/api/v3/release`;
    try {
      const res: AxiosResponse<SonarrRelease[]> = await this.http.get('/api/v3/release', {
        params: { seriesId: args.seriesId, episodeId: args.episodeId }
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

