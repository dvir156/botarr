import type { ToolName } from '../types/index.js';

export type PendingAction =
  | {
      type: 'movie_search_pick';
      createdAtMs: number;
      expiresAtMs: number;
      items: Array<{ tmdbId: number; label: string }>;
    }
  | {
      type: 'series_search_pick';
      createdAtMs: number;
      expiresAtMs: number;
      items: Array<{ tvdbId: number; label: string }>;
    }
  | {
      type: 'movie_release_pick';
      createdAtMs: number;
      expiresAtMs: number;
      items: Array<{
        label: string;
        toolName: Extract<ToolName, 'grabMovieRelease'>;
        toolArgs: { guid: string };
      }>;
    }
  | {
      type: 'series_release_pick';
      createdAtMs: number;
      expiresAtMs: number;
      items: Array<{
        label: string;
        toolName: Extract<ToolName, 'grabSeriesRelease'>;
        toolArgs: { guid: string; indexerId: number };
      }>;
    }
  | {
      type: 'episode_release_pick';
      createdAtMs: number;
      expiresAtMs: number;
      items: Array<{
        label: string;
        toolName: Extract<ToolName, 'grabSeriesRelease'>;
        toolArgs: { guid: string; indexerId: number };
      }>;
    };

const store = new Map<number, PendingAction>();

export function setPendingAction(userId: number, action: PendingAction): void {
  store.set(userId, action);
}

export function clearPendingAction(userId: number): void {
  store.delete(userId);
}

export function getPendingAction(userId: number, nowMs: number): PendingAction | null {
  const a = store.get(userId);
  if (!a) return null;
  if (nowMs > a.expiresAtMs) {
    store.delete(userId);
    return null;
  }
  return a;
}

/** User wants to dismiss a pending 1–5 release choice (plain Telegram text, no LLM). */
export function isReleaseSelectionCancelIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length === 0 || t.length > 96) return false;
  const oneLine = t.replace(/\s+/g, ' ');
  const patterns: RegExp[] = [
    /^cancel(?:\s+(it|that|this|the\s+download))?$/,
    /^never\s*mind$/,
    /^nevermind$/,
    /^stop$/,
    /^abort$/,
    /^no\s*thanks?$/,
    /^forget\s*it$/,
    /^nvm$/,
    /^skip$/,
    /^not\s+now$/,
    /^don'?t\s+download$/,
    /^dismiss$/
  ];
  return patterns.some((re) => re.test(oneLine));
}

