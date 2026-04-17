import { HttpError } from '../types/index.js';

export function formatHttpErrorForUser(err: HttpError): string {
  const s = err.status;
  if (s === 401 || s === 403) {
    return `The media server rejected the API key (HTTP ${s}). Check RADARR_API_KEY, SONARR_API_KEY, or PLEX_TOKEN in your configuration.`;
  }
  if (s === 404) {
    return 'Nothing was found for that request (HTTP 404). The title might be missing from Radarr/Sonarr or the path is wrong.';
  }
  if (s === null) {
    return 'Could not reach a media server (network or DNS). Check RADARR_URL, SONARR_URL, and PLEX_URL.';
  }
  return `A media server returned an error (HTTP ${s}). Try again later.`;
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
