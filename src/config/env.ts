import 'dotenv/config';
import { z } from 'zod';

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

let cachedTelegramEnv: TelegramEnv | null = null;
let cachedAgentEnv: AgentEnv | null = null;
let cachedRadarrEnv: RadarrEnv | null = null;
let cachedSonarrEnv: SonarrEnv | null = null;

const TelegramEnvSchema = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    /** Single allowed user (legacy). Merged with TELEGRAM_ALLOWED_USER_IDS if both set. */
    TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int().positive().optional(),
    /** Comma- or space-separated Telegram user IDs allowed to use the bot. */
    TELEGRAM_ALLOWED_USER_IDS: z.string().optional()
  })
  .transform((raw) => {
    const ids = new Set<number>();
    if (raw.TELEGRAM_ALLOWED_USER_IDS?.trim()) {
      for (const part of raw.TELEGRAM_ALLOWED_USER_IDS.split(/[\s,]+/)) {
        if (!part) continue;
        const n = Number(part);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    }
    if (typeof raw.TELEGRAM_ALLOWED_USER_ID === 'number') {
      ids.add(raw.TELEGRAM_ALLOWED_USER_ID);
    }
    if (ids.size === 0) {
      throw new Error(
        'Set TELEGRAM_ALLOWED_USER_IDS (comma-separated) or TELEGRAM_ALLOWED_USER_ID'
      );
    }
    return {
      TELEGRAM_BOT_TOKEN: raw.TELEGRAM_BOT_TOKEN,
      TELEGRAM_ALLOWED_USER_IDS: [...ids]
    };
  });

export type TelegramEnv = {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_USER_IDS: number[];
};

const RadarrEnvSchema = z.object({
  RADARR_URL: z.string().url().transform(normalizeBaseUrl),
  RADARR_API_KEY: z.string().min(1)
});
export type RadarrEnv = z.infer<typeof RadarrEnvSchema>;

const SonarrEnvSchema = z.object({
  SONARR_URL: z.string().url().transform(normalizeBaseUrl),
  SONARR_API_KEY: z.string().min(1)
});
export type SonarrEnv = z.infer<typeof SonarrEnvSchema>;

const PlexEnvSchema = z.object({
  PLEX_URL: z.string().url().transform(normalizeBaseUrl),
  PLEX_TOKEN: z.string().min(1)
});
export type PlexEnv = z.infer<typeof PlexEnvSchema>;

/** `undefined` until first read; `null` when both PLEX_URL and PLEX_TOKEN are unset (Plex disabled). */
let cachedPlexEnv: PlexEnv | null | undefined;

const AgentEnvSchema = z.object({
  // Which LLM backend to use at runtime:
  // - openai_responses: OpenAI Responses API (requires OPENAI_API_KEY)
  // - local_openai_compat: local OpenAI-compatible Chat Completions server (no key required by default)
  LLM_PROVIDER: z
    .enum(['openai_responses', 'local_openai_compat'])
    .optional()
    .default('openai_responses'),

  // OpenAI (production)
  OPENAI_API_KEY: z.string().optional().default(''),

  // Local OpenAI-compatible server (Ollama/LM Studio/etc). Example Ollama: http://localhost:11434/v1
  LOCAL_LLM_BASE_URL: z
    .string()
    .url()
    .optional()
    .default('http://localhost:11434/v1')
    .transform(normalizeBaseUrl),

  // Model names differ by provider (examples: "gpt-5" for OpenAI, "llama3.1" for Ollama)
  LLM_MODEL: z.string().min(1).optional().default('gpt-5')
});

export type AgentEnv = z.infer<typeof AgentEnvSchema>;

/** Call after getAgentEnv() resolves. Ensures OpenAI key exists when using cloud API. */
export function validateAgentEnvForStartup(): void {
  const agent = getAgentEnv();
  if (agent.LLM_PROVIDER === 'openai_responses' && !agent.OPENAI_API_KEY.trim()) {
    throw new Error(
      'LLM_PROVIDER=openai_responses requires a non-empty OPENAI_API_KEY (or set LLM_PROVIDER=local_openai_compat for local Ollama/LM Studio).'
    );
  }
}

export function getTelegramEnv(): TelegramEnv {
  if (cachedTelegramEnv) return cachedTelegramEnv;

  const parsed = TelegramEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Telegram environment variables:\n${msg}`);
  }

  cachedTelegramEnv = parsed.data;
  return cachedTelegramEnv;
}

export function getAgentEnv(): AgentEnv {
  if (cachedAgentEnv) return cachedAgentEnv;
  const parsed = AgentEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid agent environment variables:\n${msg}`);
  }
  cachedAgentEnv = parsed.data;
  return cachedAgentEnv;
}

export function getRadarrEnv(): RadarrEnv {
  if (cachedRadarrEnv) return cachedRadarrEnv;
  const parsed = RadarrEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Radarr environment variables:\n${msg}`);
  }
  cachedRadarrEnv = parsed.data;
  return cachedRadarrEnv;
}

export function getSonarrEnv(): SonarrEnv {
  if (cachedSonarrEnv) return cachedSonarrEnv;
  const parsed = SonarrEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Sonarr environment variables:\n${msg}`);
  }
  cachedSonarrEnv = parsed.data;
  return cachedSonarrEnv;
}

/**
 * Load Plex settings from the environment. Call once at startup (or lazily via getPlexEnv).
 * Omit both PLEX_URL and PLEX_TOKEN to run without Plex.
 */
export function loadPlexEnv(): void {
  if (cachedPlexEnv !== undefined) return;

  const url = (process.env.PLEX_URL ?? '').trim();
  const token = (process.env.PLEX_TOKEN ?? '').trim();

  if (!url && !token) {
    cachedPlexEnv = null;
    return;
  }
  if (!url || !token) {
    throw new Error(
      'Plex: set both PLEX_URL and PLEX_TOKEN, or leave both unset to run without Plex.'
    );
  }

  const parsed = PlexEnvSchema.safeParse({ PLEX_URL: url, PLEX_TOKEN: token });
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Plex environment variables:\n${msg}`);
  }
  cachedPlexEnv = parsed.data;
}

export function isPlexConfigured(): boolean {
  loadPlexEnv();
  return cachedPlexEnv !== null;
}

export function getPlexEnv(): PlexEnv {
  loadPlexEnv();
  if (!cachedPlexEnv) {
    throw new Error('Plex is not configured. Set PLEX_URL and PLEX_TOKEN to enable Plex.');
  }
  return cachedPlexEnv;
}

