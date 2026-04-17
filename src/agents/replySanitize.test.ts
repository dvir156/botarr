import { describe, expect, it } from 'vitest';
import { sanitizeAgentReplyText } from './replySanitize.js';

describe('sanitizeAgentReplyText', () => {
  it('removes leaked tool-call lines (lowercase identifier)', () => {
    expect(sanitizeAgentReplyText('previewMovieReleases(tmdbId=986056)')).toContain('options');
  });

  it('keeps movie titles with year in parentheses', () => {
    expect(sanitizeAgentReplyText('1. Thunderbolts* (2025)\nhttps://example.com')).toContain('Thunderbolts');
  });
});
