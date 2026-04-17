import type { PreferencesDb } from './db.js';
import { openPreferencesDb } from './db.js';
import {
  defaultUserPreferences,
  UserPreferencesPatchSchema,
  UserPreferencesSchema,
  type UserPreferences,
  type UserPreferencesPatch
} from './preferencesSchema.js';

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export type PreferencesRepo = {
  get: (telegramUserId: number) => UserPreferences;
  setPatch: (telegramUserId: number, patch: UserPreferencesPatch) => UserPreferences;
  reset: (telegramUserId: number) => UserPreferences;
  formatForPrompt: (prefs: UserPreferences) => string;
};

export function createPreferencesRepo(db: PreferencesDb = openPreferencesDb()): PreferencesRepo {
  const selectStmt = db.prepare(
    'SELECT prefs_json FROM user_preferences WHERE telegram_user_id = ?'
  );
  const upsertStmt = db.prepare(
    `INSERT INTO user_preferences (telegram_user_id, prefs_json, updated_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at_ms = excluded.updated_at_ms`
  );
  const deleteStmt = db.prepare('DELETE FROM user_preferences WHERE telegram_user_id = ?');

  function get(telegramUserId: number): UserPreferences {
    const row = selectStmt.get(telegramUserId) as { prefs_json?: string } | undefined;
    if (!row?.prefs_json) return defaultUserPreferences();
    const parsed = UserPreferencesSchema.safeParse(safeJsonParse(row.prefs_json));
    return parsed.success ? parsed.data : defaultUserPreferences();
  }

  function reset(telegramUserId: number): UserPreferences {
    deleteStmt.run(telegramUserId);
    return defaultUserPreferences();
  }

  function setPatch(telegramUserId: number, patch: UserPreferencesPatch): UserPreferences {
    const patchParsed = UserPreferencesPatchSchema.parse(patch);
    const next = UserPreferencesSchema.parse({ ...get(telegramUserId), ...patchParsed });
    upsertStmt.run(telegramUserId, JSON.stringify(next), Date.now());
    return next;
  }

  function formatForPrompt(prefs: UserPreferences): string {
    const lines: string[] = [];
    lines.push('## User preferences');
    lines.push(`- Preferred resolution: ${prefs.preferredResolution}`);
    if (prefs.preferHevc !== null) lines.push(`- Prefer HEVC/x265: ${prefs.preferHevc ? 'yes' : 'no'}`);
    if (prefs.minSeeders !== null) lines.push(`- Minimum seeders: ${prefs.minSeeders}`);
    if (prefs.maxSizeGb !== null) lines.push(`- Max size: ${prefs.maxSizeGb} GB`);
    if (prefs.language) lines.push(`- Language: ${prefs.language}`);
    if (prefs.blockKeywords.length > 0) lines.push(`- Block keywords: ${prefs.blockKeywords.join(', ')}`);
    if (prefs.preferKeywords.length > 0) lines.push(`- Prefer keywords: ${prefs.preferKeywords.join(', ')}`);
    if (prefs.notes) lines.push(`- Notes: ${prefs.notes}`);
    return lines.join('\n');
  }

  return { get, setPatch, reset, formatForPrompt };
}

