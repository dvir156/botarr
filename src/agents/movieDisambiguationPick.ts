import { getConversationTurns } from './conversationHistory.js';
import type {
  PreviewMovieReleasesResult,
  PreviewSeriesReleasesResult,
  SearchMovieResult,
  SearchSeriesResult
} from '../types/index.js';

export function getLastAssistantContent(userId: number): string | null {
  const turns = getConversationTurns(userId);
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t?.role === 'assistant') return t.content;
  }
  return null;
}

const MOVIE_LINE = /^\s*(\d{1,2})\.\s+.+/;
const TMDB_MOVIE = /themoviedb\.org\/movie\/(\d+)/;
const TVDB_SERIES = /thetvdb\.com\/\?tab=series&id=(\d+)/i;

function titlePartFromListLine(line: string): string {
  const afterNum = line.replace(/^\s*\d{1,2}\.\s*/, '');
  return afterNum.split(/\s*-\s*https/)[0]?.split(/,\s*https/)[0]?.trim() ?? '';
}

/** Display title from a numbered row (for release preview header). */
export function extractTitleFromNumberedMovieLine(
  assistantContent: string,
  choice: number
): string | null {
  for (const line of assistantContent.split('\n')) {
    const num = MOVIE_LINE.exec(line);
    if (!num || Number(num[1]) !== choice) continue;
    const raw = titlePartFromListLine(line);
    return raw.length > 0 ? raw : null;
  }
  return null;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Last assistant message looks like a numbered TMDB movie pick list (from searchMovie). */
export function looksLikeMovieSearchList(assistantContent: string): boolean {
  const m = assistantContent.match(/themoviedb\.org\/movie\/\d+/g);
  return (m?.length ?? 0) >= 2;
}

/** Numbered Sonarr/TVDB disambiguation list (from searchSeries). */
export function looksLikeSeriesSearchList(assistantContent: string): boolean {
  const m = assistantContent.match(/thetvdb\.com\/\?tab=series&id=\d+/gi);
  return (m?.length ?? 0) >= 2;
}

/** Rows with TMDB movie links (for inline keyboard after assistant lists matches). */
export function parseMovieSearchListItems(assistantContent: string): Array<{ tmdbId: number; label: string }> {
  const out: Array<{ tmdbId: number; label: string }> = [];
  for (const line of assistantContent.split('\n')) {
    const num = MOVIE_LINE.exec(line);
    if (!num) continue;
    const url = TMDB_MOVIE.exec(line);
    if (!url) continue;
    const labelRaw = titlePartFromListLine(line);
    const label =
      labelRaw.length > 0 ? labelRaw : `Movie ${num[1]}`;
    out.push({ tmdbId: Number(url[1]), label });
  }
  return out;
}

/** Rows with TVDB series links (Sonarr preview uses internal series id after ensure). */
export function parseSeriesSearchListItems(assistantContent: string): Array<{ tvdbId: number; label: string }> {
  const out: Array<{ tvdbId: number; label: string }> = [];
  for (const line of assistantContent.split('\n')) {
    const num = MOVIE_LINE.exec(line);
    if (!num) continue;
    const url = TVDB_SERIES.exec(line);
    if (!url) continue;
    const labelRaw = titlePartFromListLine(line);
    const label =
      labelRaw.length > 0 ? labelRaw : `Series ${num[1]}`;
    out.push({ tvdbId: Number(url[1]), label });
  }
  return out;
}

/**
 * When the user types the movie title/year instead of a number (e.g. "Thunderbolts (2025)"),
 * match the row against the previous list.
 */
export function parseTmdbIdFromListByTitleHint(
  assistantContent: string,
  userText: string
): number | null {
  const stripped = userText.trim().replace(/^\d{1,2}\.\s*/, '');
  const u = normalizeForMatch(stripped);
  if (u.length < 3) return null;

  const lines = assistantContent.split('\n');
  const scored: Array<{ id: number; score: number }> = [];
  for (const line of lines) {
    const url = TMDB_MOVIE.exec(line);
    if (!url) continue;
    const id = Number(url[1]);
    const titlePart = titlePartFromListLine(line);
    const t = normalizeForMatch(titlePart);
    if (t.length < 2) continue;

    let score = 0;
    if (t === u) score = 100;
    else if (t.includes(u) || u.includes(t)) score = 85;
    else {
      const words = u.split(/\s+/).filter((w) => w.length > 1);
      const hits = words.filter((w) => t.includes(w)).length;
      score = hits * 12;
    }
    scored.push({ id, score });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 24) return null;
  if (scored.length > 1 && scored[1]!.score === best.score) return null;
  return best.id;
}

/**
 * Parse the TMDB id for a numbered row in the assistant’s movie list (searchMovie output).
 */
export function parseTmdbIdFromNumberedMovieList(assistantContent: string, choice: number): number | null {
  if (!Number.isFinite(choice) || choice < 1 || choice > 99) return null;
  const lines = assistantContent.split('\n');
  for (const line of lines) {
    const num = MOVIE_LINE.exec(line);
    if (!num) continue;
    const n = Number(num[1]);
    if (n !== choice) continue;
    const url = TMDB_MOVIE.exec(line);
    if (url) return Number(url[1]);
  }
  return null;
}

export function formatMovieSearchMatchesReply(result: SearchMovieResult): string {
  const matches = result.matches ?? [];
  if (matches.length === 0) {
    return 'No matches found. Try a different title.';
  }
  const lines: string[] = [];
  lines.push('Here are matches:');
  lines.push('');
  matches.slice(0, 10).forEach((m, i) => {
    const year = m.year != null ? ` (${m.year})` : '';
    lines.push(`${i + 1}. ${m.title}${year} - ${m.tmdbUrl}`);
  });
  lines.push('');
  lines.push('Reply with a number (1–10) to pick one (or use the buttons if shown).');
  return lines.join('\n');
}

export function formatSeriesSearchMatchesReply(result: SearchSeriesResult): string {
  const matches = result.matches ?? [];
  if (matches.length === 0) {
    return 'No matches found. Try a different title.';
  }
  const lines: string[] = [];
  lines.push('Here are matches:');
  lines.push('');
  matches.slice(0, 10).forEach((m, i) => {
    const year = m.year != null ? ` (${m.year})` : '';
    const extra = m.tmdbUrl ? `, ${m.tmdbUrl}` : '';
    lines.push(`${i + 1}. ${m.title}${year} - ${m.tvdbUrl}${extra}`);
  });
  lines.push('');
  lines.push('Reply with a number (1–10) to pick one (or use the buttons if shown).');
  return lines.join('\n');
}

function formatSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes >= 1e9) return ` ~${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return ` ~${(bytes / 1e6).toFixed(0)} MB`;
  return ` ~${bytes} B`;
}

/** User-facing text after previewMovieReleases (deterministic path). */
export function formatMovieReleasePreviewReply(
  result: PreviewMovieReleasesResult,
  options?: { label?: string }
): string {
  const label = options?.label?.trim();
  const lines: string[] = [];
  const head =
    label && label.length > 0
      ? `Available releases for ${label}:`
      : result.addedToRadarr
        ? 'Added the movie to Radarr. Here are release candidates:'
        : 'Here are release candidates:';
  lines.push(head);
  result.candidates.forEach((c, i) => {
    const n = i + 1;
    const q = c.quality ?? 'unknown';
    const s = c.seeders != null ? String(c.seeders) : '?';
    const l = c.leechers != null ? String(c.leechers) : '?';
    lines.push(
      `${n}. ${c.title} — ${q}${formatSize(c.sizeBytes)} — seeders ${s}, leechers ${l}`
    );
  });
  if (result.recommendedChoice != null && result.candidates.length > 0) {
    lines.push('');
    lines.push(
      `Recommended: ${result.recommendedChoice} — ${result.recommendationHint}`
    );
  }
  lines.push('');
  lines.push('Reply with 1–5 to download one of these (or use the buttons if shown).');
  return lines.join('\n');
}

/** User-facing text after previewSeriesReleases (deterministic path). */
export function formatSeriesReleasePreviewReply(
  result: PreviewSeriesReleasesResult,
  options?: { label?: string; addedToSonarr?: boolean }
): string {
  const label = options?.label?.trim();
  const lines: string[] = [];
  const head =
    label && label.length > 0
      ? `Available releases for ${label}:`
      : options?.addedToSonarr
        ? 'Added the series to Sonarr. Here are release candidates:'
        : 'Here are release candidates:';
  lines.push(head);
  result.candidates.forEach((c, i) => {
    const n = i + 1;
    const q = c.quality ?? 'unknown';
    const s = c.seeders != null ? String(c.seeders) : '?';
    const l = c.leechers != null ? String(c.leechers) : '?';
    lines.push(
      `${n}. ${c.title} — ${q}${formatSize(c.sizeBytes)} — seeders ${s}, leechers ${l}`
    );
  });
  if (result.recommendedChoice != null && result.candidates.length > 0) {
    lines.push('');
    lines.push(
      `Recommended: ${result.recommendedChoice} — ${result.recommendationHint}`
    );
  }
  lines.push('');
  lines.push('Reply with 1–5 to download one of these (or use the buttons if shown).');
  return lines.join('\n');
}
