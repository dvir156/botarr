import { describe, expect, it, vi } from 'vitest';
import { RadarrClient } from './radarrClient.js';

const postMock = vi.fn();

vi.mock('axios', () => {
  return {
    default: {
      create: () => ({
        get: vi.fn(),
        post: postMock
      }),
      isAxiosError: () => false
    }
  };
});

vi.mock('../config/env.js', () => ({
  getRadarrEnv: () => ({
    RADARR_URL: 'http://radarr.local',
    RADARR_API_KEY: 'test'
  })
}));

describe('RadarrClient', () => {
  it('grabs releases via POST /api/v3/release with guid body', async () => {
    postMock.mockResolvedValueOnce({ data: null });
    const c = new RadarrClient();
    await c.grabRelease({ guid: 'guid-1', indexerId: 10 });
    expect(postMock).toHaveBeenCalledWith('/api/v3/release', { guid: 'guid-1', indexerId: 10 });
  });
});

