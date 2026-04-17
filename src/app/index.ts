import {
  getRadarrEnv,
  getSonarrEnv,
  getTelegramEnv,
  loadPlexEnv,
  validateAgentEnvForStartup
} from '../config/env.js';
import { logger } from '../config/logger.js';
import { startTelegramBot } from '../bot/telegram.js';
import { runStartupHealthChecks } from '../startup/healthCheck.js';

function sanitizeSecrets(s: string): string {
  return s.replace(/bot\\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>');
}

export async function main(): Promise<void> {
  getTelegramEnv();
  validateAgentEnvForStartup();
  getRadarrEnv();
  getSonarrEnv();
  loadPlexEnv();
  await runStartupHealthChecks();
  await startTelegramBot();
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error('Unknown error');
  logger.error('fatal', {
    error: sanitizeSecrets(e.message),
    stack: e.stack ? sanitizeSecrets(e.stack) : undefined
  });
  process.exitCode = 1;
});

