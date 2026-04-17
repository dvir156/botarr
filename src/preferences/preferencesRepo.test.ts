import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createPreferencesRepo } from './preferencesRepo.js';

describe('preferencesRepo', () => {
  it('defaults, setPatch, and reset roundtrip', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE user_preferences (
        telegram_user_id INTEGER PRIMARY KEY,
        prefs_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
    `);
    const repo = createPreferencesRepo(db);
    const userId = 123;

    const d = repo.get(userId);
    expect(d.preferredResolution).toBe('any');

    const updated = repo.setPatch(userId, { preferredResolution: '2160p', minSeeders: 5 });
    expect(updated.preferredResolution).toBe('2160p');
    expect(updated.minSeeders).toBe(5);

    const readBack = repo.get(userId);
    expect(readBack.preferredResolution).toBe('2160p');
    expect(readBack.minSeeders).toBe(5);

    const reset = repo.reset(userId);
    expect(reset.preferredResolution).toBe('any');
    expect(repo.get(userId).preferredResolution).toBe('any');
  });
});

