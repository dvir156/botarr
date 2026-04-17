import axios from 'axios';
import { getPlexEnv, getRadarrEnv, getSonarrEnv, isPlexConfigured } from '../config/env.js';
import { logger } from '../config/logger.js';

const TIMEOUT_MS = 8_000;

type ServiceOk = { ok: true; displayUrl: string };
type ServiceFail = { ok: false; startupIssue: string; statusLine: string };

async function checkRadarr(): Promise<ServiceOk | ServiceFail> {
  const radarr = getRadarrEnv();
  try {
    const res = await axios.get(`${radarr.RADARR_URL}/api/v3/system/status`, {
      headers: { 'X-Api-Key': radarr.RADARR_API_KEY },
      timeout: TIMEOUT_MS,
      validateStatus: () => true
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        startupIssue: `Radarr: HTTP ${res.status} (check RADARR_API_KEY)`,
        statusLine: `Radarr: HTTP ${res.status}`
      };
    }
    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        startupIssue: `Radarr: HTTP ${res.status} from ${radarr.RADARR_URL}`,
        statusLine: `Radarr: HTTP ${res.status}`
      };
    }
    return { ok: true, displayUrl: radarr.RADARR_URL };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      startupIssue: `Radarr: unreachable (${msg})`,
      statusLine: `Radarr: error — ${msg}`
    };
  }
}

async function checkSonarr(): Promise<ServiceOk | ServiceFail> {
  const sonarr = getSonarrEnv();
  try {
    const res = await axios.get(`${sonarr.SONARR_URL}/api/v3/system/status`, {
      headers: { 'X-Api-Key': sonarr.SONARR_API_KEY },
      timeout: TIMEOUT_MS,
      validateStatus: () => true
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        startupIssue: `Sonarr: HTTP ${res.status} (check SONARR_API_KEY)`,
        statusLine: `Sonarr: HTTP ${res.status}`
      };
    }
    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        startupIssue: `Sonarr: HTTP ${res.status} from ${sonarr.SONARR_URL}`,
        statusLine: `Sonarr: HTTP ${res.status}`
      };
    }
    return { ok: true, displayUrl: sonarr.SONARR_URL };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      startupIssue: `Sonarr: unreachable (${msg})`,
      statusLine: `Sonarr: error — ${msg}`
    };
  }
}

async function checkPlex(): Promise<ServiceOk | ServiceFail> {
  const plex = getPlexEnv();
  try {
    const res = await axios.get(`${plex.PLEX_URL}/identity`, {
      params: { 'X-Plex-Token': plex.PLEX_TOKEN },
      timeout: TIMEOUT_MS,
      validateStatus: () => true
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        startupIssue: `Plex: HTTP ${res.status} (check PLEX_TOKEN)`,
        statusLine: `Plex: HTTP ${res.status}`
      };
    }
    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        startupIssue: `Plex: HTTP ${res.status} from ${plex.PLEX_URL}`,
        statusLine: `Plex: HTTP ${res.status}`
      };
    }
    return { ok: true, displayUrl: plex.PLEX_URL };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      startupIssue: `Plex: unreachable (${msg})`,
      statusLine: `Plex: error — ${msg}`
    };
  }
}

/**
 * Ping Radarr, Sonarr, and Plex at startup so bad URLs/keys fail fast instead of on first tool call.
 */
export async function runStartupHealthChecks(): Promise<void> {
  const issues: string[] = [];

  const radarr = await checkRadarr();
  if (!radarr.ok) issues.push(radarr.startupIssue);

  const sonarr = await checkSonarr();
  if (!sonarr.ok) issues.push(sonarr.startupIssue);

  if (isPlexConfigured()) {
    const plex = await checkPlex();
    if (!plex.ok) issues.push(plex.startupIssue);
  }

  if (issues.length > 0) {
    const text = issues.join('\n');
    logger.error('startup.health.failed', { issues });
    throw new Error(`Media service health check failed:\n${text}`);
  }

  logger.info('startup.health.ok', { radarr: true, sonarr: true, plex: isPlexConfigured() });
}

/** Lighter check for /status command (no throw). */
export async function getMediaServicesStatusText(): Promise<string> {
  const lines: string[] = [];

  const radarr = await checkRadarr();
  lines.push(radarr.ok ? `Radarr: OK (${radarr.displayUrl})` : radarr.statusLine);

  const sonarr = await checkSonarr();
  lines.push(sonarr.ok ? `Sonarr: OK (${sonarr.displayUrl})` : sonarr.statusLine);

  if (isPlexConfigured()) {
    const plex = await checkPlex();
    lines.push(plex.ok ? `Plex: OK (${plex.displayUrl})` : plex.statusLine);
  } else {
    lines.push('Plex: not configured (set PLEX_URL and PLEX_TOKEN to enable)');
  }

  return lines.join('\n');
}
