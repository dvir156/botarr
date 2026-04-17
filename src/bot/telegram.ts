import { Markup, Telegraf, type Context } from 'telegraf';
import { mediaAgent } from '../agents/mediaAgent.js';
import { getPendingAction } from '../agents/pendingActions.js';
import { getTelegramEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getMediaServicesStatusText } from '../startup/healthCheck.js';
import { chunkTelegramText } from './telegramChunks.js';
import { formatHttpErrorForUser, isHttpError } from '../util/httpErrorMessage.js';
import { createPreferencesRepo } from '../preferences/preferencesRepo.js';
import { runSerializedForUser } from './runSerializedForUser.js';

const RELEASE_PICK_PREFIX = 'rp:';

/** Chat id for typing (inline callbacks sometimes omit `ctx.chat`). */
function resolveChatIdForTyping(ctx: Context): number | undefined {
  const fromChat = ctx.chat?.id;
  if (typeof fromChat === 'number') return fromChat;
  const fromCb = ctx.callbackQuery?.message && 'chat' in ctx.callbackQuery.message
    ? ctx.callbackQuery.message.chat?.id
    : undefined;
  return typeof fromCb === 'number' ? fromCb : undefined;
}

async function sendTypingIfPossible(ctx: Context): Promise<void> {
  const chatId = resolveChatIdForTyping(ctx);
  if (chatId === undefined) return;
  await ctx.telegram.sendChatAction(chatId, 'typing');
}

const HELP_TEXT = [
  'Commands:',
  '/help — this message',
  '/status — Radarr, Sonarr, and Plex reachability',
  '/cancel — cancel a pending release choice (same as sending cancel)',
  '/prefs — show your saved preferences',
  '/prefs_set key=value — set a preference',
  '/prefs_reset — reset preferences to defaults',
  '',
  'Or chat in plain English: search shows/movies, check Plex, tap a number or type it to pick from a list, or say cancel / never mind to dismiss.'
].join('\n');

function buildReleasePickMarkup(itemCount: number) {
  const n = Math.min(Math.max(itemCount, 1), 10);
  const row = [];
  for (let i = 1; i <= n; i++) {
    row.push(Markup.button.callback(String(i), `${RELEASE_PICK_PREFIX}${i}`));
  }
  return Markup.inlineKeyboard([row, [Markup.button.callback('Cancel', `${RELEASE_PICK_PREFIX}cancel`)]]);
}

async function replyInChunksWithOptionalKeyboard(args: {
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> };
  text: string;
  telegramUserId: number;
}): Promise<void> {
  const chunks = chunkTelegramText(args.text);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    const isLast = i === chunks.length - 1;
    const pending = isLast ? getPendingAction(args.telegramUserId, Date.now()) : null;
    const extra =
      pending && pending.items.length > 0
        ? buildReleasePickMarkup(pending.items.length)
        : undefined;
    await args.ctx.reply(chunk, extra);
  }
}

export async function startTelegramBot(): Promise<void> {
  const env = getTelegramEnv();
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  logger.info('telegram.bot.initialized');
  const prefsRepo = createPreferencesRepo();

  bot.catch((err) => {
    const e = err instanceof Error ? err : new Error('Unknown error');
    logger.error('telegram.bot.unhandled_error', { error: e.message, stack: e.stack });
  });

  async function runAgentForUser(args: {
    ctx: { reply: (text: string, extra?: object) => Promise<unknown> };
    text: string;
    fromId: number;
  }): Promise<void> {
    try {
      const res = await mediaAgent({ text: args.text, telegramUserId: args.fromId });
      await replyInChunksWithOptionalKeyboard({
        ctx: args.ctx,
        text: res.replyText,
        telegramUserId: args.fromId
      });
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Unknown error');
      logger.error('telegram.handler.error', { error: e.message });
      if (isHttpError(err)) {
        await args.ctx.reply(formatHttpErrorForUser(err));
        return;
      }
      await args.ctx.reply('Sorry — something went wrong. Try again.');
    }
  }

  bot.command('help', async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !env.TELEGRAM_ALLOWED_USER_IDS.includes(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    await ctx.reply(HELP_TEXT);
  });

  bot.command('status', async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !env.TELEGRAM_ALLOWED_USER_IDS.includes(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    await sendTypingIfPossible(ctx);
    try {
      const text = await getMediaServicesStatusText();
      await ctx.reply(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(`Status check failed: ${msg}`);
    }
  });

  bot.command('cancel', async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !env.TELEGRAM_ALLOWED_USER_IDS.includes(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    await sendTypingIfPossible(ctx);
    await runSerializedForUser(fromId, () => runAgentForUser({ ctx, text: 'cancel', fromId }));
  });

  bot.command('prefs', async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !env.TELEGRAM_ALLOWED_USER_IDS.includes(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    const prefs = prefsRepo.get(fromId);
    const text = prefsRepo.formatForPrompt(prefs);
    await ctx.reply(text);
  });

  bot.command('prefs_reset', async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !env.TELEGRAM_ALLOWED_USER_IDS.includes(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    const prefs = prefsRepo.reset(fromId);
    await ctx.reply('Preferences reset.');
    await ctx.reply(prefsRepo.formatForPrompt(prefs));
  });

  bot.command('prefs_set', async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !env.TELEGRAM_ALLOWED_USER_IDS.includes(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }
    const raw = ctx.message.text ?? '';
    const rest = raw.replace(/^\/prefs_set(?:@\w+)?\s*/i, '').trim();
    const eq = rest.indexOf('=');
    if (!rest || eq <= 0) {
      await ctx.reply('Usage: /prefs_set key=value');
      return;
    }
    const key = rest.slice(0, eq).trim();
    const valueRaw = rest.slice(eq + 1).trim();

    const patch: Record<string, unknown> = {};
    const toBool = (s: string): boolean | null => {
      if (/^(true|yes|y|1)$/i.test(s)) return true;
      if (/^(false|no|n|0)$/i.test(s)) return false;
      if (/^(null|unset|default)$/i.test(s)) return null;
      return null;
    };

    switch (key) {
      case 'preferredResolution':
        patch.preferredResolution = valueRaw;
        break;
      case 'preferHevc':
        patch.preferHevc = toBool(valueRaw);
        break;
      case 'minSeeders':
        if (!valueRaw.length) {
          patch.minSeeders = null;
        } else {
          const n = Number(valueRaw);
          if (!Number.isFinite(n)) {
            await ctx.reply('minSeeders must be a number (or empty to clear).');
            return;
          }
          patch.minSeeders = Math.trunc(n);
        }
        break;
      case 'maxSizeGb':
        if (!valueRaw.length) {
          patch.maxSizeGb = null;
        } else {
          const n = Number(valueRaw);
          if (!Number.isFinite(n)) {
            await ctx.reply('maxSizeGb must be a number (or empty to clear).');
            return;
          }
          patch.maxSizeGb = n;
        }
        break;
      case 'language':
        patch.language = valueRaw.length ? valueRaw : null;
        break;
      case 'blockKeywords':
        patch.blockKeywords = valueRaw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        break;
      case 'preferKeywords':
        patch.preferKeywords = valueRaw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        break;
      case 'notes':
        patch.notes = valueRaw.length ? valueRaw : null;
        break;
      default:
        await ctx.reply(
          'Unknown key. Supported: preferredResolution, preferHevc, minSeeders, maxSizeGb, language, blockKeywords, preferKeywords, notes'
        );
        return;
    }

    try {
      const prefs = prefsRepo.setPatch(fromId, patch);
      await ctx.reply('Saved.');
      await ctx.reply(prefsRepo.formatForPrompt(prefs));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(`Could not save: ${msg}`);
    }
  });

  bot.on('callback_query', async (ctx) => {
    const fromId = ctx.from?.id;
    const cq = ctx.callbackQuery;
    const data = cq && 'data' in cq ? cq.data : undefined;
    if (!fromId || !env.TELEGRAM_ALLOWED_USER_IDS.includes(fromId)) {
      await ctx.answerCbQuery('Unauthorized');
      return;
    }
    if (!data?.startsWith(RELEASE_PICK_PREFIX)) {
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery();
    const action = data.slice(RELEASE_PICK_PREFIX.length);
    const text = action === 'cancel' ? 'cancel' : action;
    await sendTypingIfPossible(ctx);
    await runSerializedForUser(fromId, () => runAgentForUser({ ctx, text, fromId }));
  });

  bot.on('text', async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || !env.TELEGRAM_ALLOWED_USER_IDS.includes(fromId)) {
      await ctx.reply('Unauthorized.');
      return;
    }

    const text = ctx.message.text;
    if (/^\s*\//.test(text)) {
      return;
    }

    await sendTypingIfPossible(ctx);
    await runSerializedForUser(fromId, () => runAgentForUser({ ctx, text, fromId }));
  });

  try {
    const me = await bot.telegram.getMe();
    logger.info('telegram.bot.identity', { id: me.id, username: me.username });
    logger.info('telegram.bot.launching');
    void bot.launch().then(
      () => logger.info('telegram.bot.stopped'),
      (err: unknown) => {
        const e = err instanceof Error ? err : new Error('Unknown error');
        logger.error('telegram.bot.launch_failed', { error: e.message, stack: e.stack });
      }
    );
    logger.info('telegram.bot.started');
  } catch (err) {
    const e = err instanceof Error ? err : new Error('Unknown error');
    logger.error('telegram.bot.launch_failed', { error: e.message, stack: e.stack });
    throw e;
  }

  const shutdown = async () => {
    logger.info('telegram.bot.stopping');
    await bot.stop();
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
