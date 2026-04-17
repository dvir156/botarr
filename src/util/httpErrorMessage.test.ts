import { describe, expect, it } from 'vitest';
import { HttpError } from '../types/index.js';
import { formatHttpErrorForUser } from './httpErrorMessage.js';

describe('formatHttpErrorForUser', () => {
  it('maps auth failures', () => {
    const e = new HttpError({
      message: 'x',
      status: 401,
      method: 'GET',
      url: 'http://x',
      responseBody: null
    });
    expect(formatHttpErrorForUser(e)).toContain('401');
    expect(formatHttpErrorForUser(e)).toContain('API key');
  });

  it('maps network failures', () => {
    const e = new HttpError({
      message: 'x',
      status: null,
      method: 'GET',
      url: 'http://x',
      responseBody: null
    });
    expect(formatHttpErrorForUser(e)).toContain('reach');
  });
});
