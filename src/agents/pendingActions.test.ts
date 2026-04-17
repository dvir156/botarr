import { describe, expect, it } from 'vitest';
import { isReleaseSelectionCancelIntent } from './pendingActions.js';

describe('isReleaseSelectionCancelIntent', () => {
  it('detects cancel phrases', () => {
    expect(isReleaseSelectionCancelIntent('cancel')).toBe(true);
    expect(isReleaseSelectionCancelIntent(' cancel ')).toBe(true);
    expect(isReleaseSelectionCancelIntent('never mind')).toBe(true);
    expect(isReleaseSelectionCancelIntent('nvm')).toBe(true);
    expect(isReleaseSelectionCancelIntent('stop')).toBe(true);
  });

  it('rejects unrelated text', () => {
    expect(isReleaseSelectionCancelIntent('download Dune')).toBe(false);
    expect(isReleaseSelectionCancelIntent('cancel the subscription maybe')).toBe(false);
  });
});
