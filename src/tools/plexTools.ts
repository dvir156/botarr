import { z } from 'zod';
import { isPlexConfigured } from '../config/env.js';
import { PlexClient } from '../clients/plexClient.js';
import { logger } from '../config/logger.js';
import { HttpError, type PlexAvailabilityResult } from '../types/index.js';
import { CheckAvailabilityInPlexInputSchema } from '../agents/toolSchemas.js';

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function checkAvailabilityInPlex(
  input: z.infer<typeof CheckAvailabilityInPlexInputSchema>,
  ctx: { requestId: string }
): Promise<PlexAvailabilityResult> {
  const parsed = CheckAvailabilityInPlexInputSchema.parse(input);
  const log = logger.child({ tool: 'checkAvailabilityInPlex', requestId: ctx.requestId });
  const startedAt = Date.now();

  try {
    log.info('tool.start', { title: parsed.title });
    if (!isPlexConfigured()) {
      log.info('tool.skip', { reason: 'plex_not_configured' });
      return {
        available: false,
        matches: [],
        plexNotConfigured: true
      };
    }
    const client = new PlexClient();
    const results = await client.search(parsed.title);

    const q = normalize(parsed.title);
    const matches = results.slice(0, 10).map((m) => ({
      title: m.title,
      year: m.year,
      type: m.type
    }));

    const available =
      results.some((m) => normalize(m.title) === q) ||
      results.some((m) => normalize(m.title).includes(q)) ||
      results.some((m) => q.includes(normalize(m.title)));

    log.info('tool.success', { elapsedMs: Date.now() - startedAt, available, matchCount: matches.length });
    return { available, matches };
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    const extra =
      err instanceof HttpError
        ? { status: err.status, url: err.url, method: err.method }
        : {};
    log.error('tool.error', { elapsedMs: Date.now() - startedAt, error: e.message, ...extra });
    throw err;
  }
}

