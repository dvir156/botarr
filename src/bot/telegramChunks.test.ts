import { describe, expect, it } from 'vitest';
import { chunkTelegramText, TELEGRAM_MAX_MESSAGE_LENGTH } from './telegramChunks.js';

describe('chunkTelegramText', () => {
  it('returns single chunk when short', () => {
    expect(chunkTelegramText('hello')).toEqual(['hello']);
  });

  it('splits long text', () => {
    const long = 'a'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 100);
    const chunks = chunkTelegramText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= TELEGRAM_MAX_MESSAGE_LENGTH)).toBe(true);
  });
});
