import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type PreferencesDb = Database.Database;

export function resolvePreferencesDbPath(): string {
  const fromEnv = (process.env.BOTARR_DB_PATH ?? '').trim();
  if (fromEnv) return fromEnv;
  return './data/botarr.sqlite';
}

export function openPreferencesDb(path = resolvePreferencesDbPath()): PreferencesDb {
  const dir = dirname(path);
  if (dir && dir !== '.' && dir !== path) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      telegram_user_id INTEGER PRIMARY KEY,
      prefs_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  return db;
}

