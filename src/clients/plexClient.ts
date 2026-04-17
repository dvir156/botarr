import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { getPlexEnv } from '../config/env.js';
import { HttpError, type HttpMethod } from '../types/index.js';

export type PlexSearchMatch = {
  title: string;
  year: number | null;
  type:
    | 'movie'
    | 'show'
    | 'episode'
    | 'artist'
    | 'album'
    | 'track'
    | 'unknown';
};

type PlexSearchResponseJson = {
  MediaContainer?: {
    Metadata?: Array<{
      title?: string;
      year?: number;
      type?: string;
    }>;
  };
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

function coerceType(t: string | undefined): PlexSearchMatch['type'] {
  const v = (t ?? '').toLowerCase();
  if (v === 'movie') return 'movie';
  if (v === 'show' || v === 'series') return 'show';
  if (v === 'episode') return 'episode';
  if (v === 'artist') return 'artist';
  if (v === 'album') return 'album';
  if (v === 'track') return 'track';
  return 'unknown';
}

function parseXmlMatches(xml: string): PlexSearchMatch[] {
  // Minimal, dependency-free parsing for common Plex XML shapes.
  // We only need title/year/type for availability checks.
  const matches: PlexSearchMatch[] = [];
  const regex = /<(Video|Directory)\b[^>]*\btitle="([^"]+)"[^>]*>/g;
  let m: RegExpExecArray | null = null;
  while ((m = regex.exec(xml)) !== null) {
    const tag = m[1] ?? '';
    const title = m[2] ?? '';
    const snippet = xml.slice(m.index, Math.min(xml.length, m.index + 300));
    const yearMatch = /\byear="(\d{4})"/.exec(snippet);
    const typeMatch = /\btype="([^"]+)"/.exec(snippet);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const type =
      tag === 'Video' ? coerceType(typeMatch?.[1] ?? 'movie') : coerceType('show');

    if (title.trim().length > 0) {
      matches.push({ title, year: Number.isFinite(year) ? year : null, type });
    }
  }
  return matches;
}

export class PlexClient {
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    const env = getPlexEnv();
    this.baseUrl = env.PLEX_URL;
    this.token = env.PLEX_TOKEN;
    this.http = axios.create({
      baseURL: env.PLEX_URL,
      timeout: 20_000,
      headers: {
        Accept: 'application/json'
      }
    });
  }

  async search(query: string): Promise<PlexSearchMatch[]> {
    const url = `${this.baseUrl}/search`;
    try {
      const res: AxiosResponse<PlexSearchResponseJson | string> = await this.http.get(
        '/search',
        { params: { query, 'X-Plex-Token': this.token } }
      );

      if (typeof res.data === 'string') {
        return parseXmlMatches(res.data);
      }

      const meta = res.data.MediaContainer?.Metadata ?? [];
      return meta
        .map((m) => ({
          title: m.title ?? '',
          year: typeof m.year === 'number' ? m.year : null,
          type: coerceType(m.type)
        }))
        .filter((m) => m.title.trim().length > 0);
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }

  async recentlyAdded(): Promise<PlexSearchMatch[]> {
    const url = `${this.baseUrl}/library/recentlyAdded`;
    try {
      const res: AxiosResponse<PlexSearchResponseJson | string> = await this.http.get(
        '/library/recentlyAdded',
        { params: { 'X-Plex-Token': this.token } }
      );
      if (typeof res.data === 'string') {
        return parseXmlMatches(res.data);
      }
      const meta = res.data.MediaContainer?.Metadata ?? [];
      return meta
        .map((m) => ({
          title: m.title ?? '',
          year: typeof m.year === 'number' ? m.year : null,
          type: coerceType(m.type)
        }))
        .filter((m) => m.title.trim().length > 0);
    } catch (err) {
      throw toHttpError({ err, method: 'GET', url });
    }
  }
}

