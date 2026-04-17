import { z } from 'zod';
import { getAgentEnv } from '../config/env.js';
import { createRequestId, logger } from '../config/logger.js';
import type {
  MediaAgentResponse,
  PreviewMovieReleasesResult,
  PreviewSeriesReleasesResult
} from '../types/index.js';
import { isToolPolicyError } from '../types/index.js';
import { ensureSeriesInSonarrForPreview } from '../tools/sonarrTools.js';
import { formatHttpErrorForUser, isHttpError } from '../util/httpErrorMessage.js';
import { buildMediaSystemPrompt } from './prompts/mediaSystemPrompt.js';
import { executeTool } from './executeMediaTool.js';
import { runLocalOpenAiCompatChatLoop } from './llm/localOpenAiCompatLoop.js';
import { runOpenAiResponsesLoop } from './llm/openAiResponsesLoop.js';
import { appendConversationTurn } from './conversationHistory.js';
import { createPreferencesRepo } from '../preferences/preferencesRepo.js';
import {
  clearPendingAction,
  getPendingAction,
  isReleaseSelectionCancelIntent,
  setPendingAction
} from './pendingActions.js';
import {
  extractTitleFromNumberedMovieLine,
  formatMovieReleasePreviewReply,
  formatSeriesReleasePreviewReply,
  getLastAssistantContent,
  looksLikeMovieSearchList,
  looksLikeSeriesSearchList,
  parseMovieSearchListItems,
  parseSeriesSearchListItems,
  parseTmdbIdFromListByTitleHint,
  parseTmdbIdFromNumberedMovieList
} from './movieDisambiguationPick.js';
import { sanitizeAgentReplyText } from './replySanitize.js';

const MediaAgentInput = z.object({
  text: z.string().trim().min(1),
  telegramUserId: z.number().int().positive()
});

export type { MediaAgentResponse };

async function runMoviePreviewForTmdb(params: {
  requestId: string;
  telegramUserId: number;
  userText: string;
  tmdbId: number;
  label?: string | null;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void };
}): Promise<MediaAgentResponse> {
  const { requestId, telegramUserId, userText, tmdbId, label, log } = params;
  try {
    const toolResult = await executeTool({
      requestId,
      telegramUserId,
      name: 'previewMovieReleases',
      rawArguments: JSON.stringify({ tmdbId, limit: 5 }),
      userText
    });
    const labelOpt =
      label != null && label.trim() !== '' ? { label: label.trim() } : undefined;
    const replyText = sanitizeAgentReplyText(
      formatMovieReleasePreviewReply(toolResult as PreviewMovieReleasesResult, labelOpt)
    );
    appendConversationTurn({ userId: telegramUserId, userText, assistantText: replyText });
    log.info('agent.movie_preview_done', { tmdbId });
    return { replyText };
  } catch (e) {
    if (isHttpError(e)) {
      const replyText = formatHttpErrorForUser(e);
      appendConversationTurn({ userId: telegramUserId, userText, assistantText: replyText });
      return { replyText };
    }
    throw e;
  }
}

async function runSeriesPreviewForTvdb(params: {
  requestId: string;
  telegramUserId: number;
  userText: string;
  tvdbId: number;
  label?: string | null;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void };
}): Promise<MediaAgentResponse> {
  const { requestId, telegramUserId, userText, tvdbId, label, log } = params;
  try {
    const { seriesId, added } = await ensureSeriesInSonarrForPreview({
      tvdbId,
      ctx: { requestId }
    });
    const toolResult = await executeTool({
      requestId,
      telegramUserId,
      name: 'previewSeriesReleases',
      rawArguments: JSON.stringify({ seriesId, limit: 5 }),
      userText
    });
    const fmtOpts: { label?: string; addedToSonarr?: boolean } = {};
    if (label != null && label.trim() !== '') fmtOpts.label = label.trim();
    if (added) fmtOpts.addedToSonarr = true;
    const replyText = sanitizeAgentReplyText(
      formatSeriesReleasePreviewReply(
        toolResult as PreviewSeriesReleasesResult,
        Object.keys(fmtOpts).length > 0 ? fmtOpts : undefined
      )
    );
    appendConversationTurn({ userId: telegramUserId, userText, assistantText: replyText });
    log.info('agent.series_preview_done', { seriesId, tvdbId });
    return { replyText };
  } catch (e) {
    if (isHttpError(e)) {
      const replyText = formatHttpErrorForUser(e);
      appendConversationTurn({ userId: telegramUserId, userText, assistantText: replyText });
      return { replyText };
    }
    throw e;
  }
}

export async function mediaAgent(input: unknown): Promise<MediaAgentResponse> {
  const { text, telegramUserId } = MediaAgentInput.parse(input);
  const requestId = createRequestId();
  const log = logger.child({ requestId, telegramUserId });
  const env = getAgentEnv();

  const prefsRepo = createPreferencesRepo();
  const prefs = prefsRepo.get(telegramUserId);
  const systemPrompt = buildMediaSystemPrompt({
    userPreferencesSummary: prefsRepo.formatForPrompt(prefs)
  });

  log.info('agent.start', { text });

  const pendingNow = getPendingAction(telegramUserId, Date.now());
  if (isReleaseSelectionCancelIntent(text)) {
    if (pendingNow) {
      clearPendingAction(telegramUserId);
      const replyText =
        'Cancelled — no download started. Say what you want to grab whenever you are ready.';
      appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
      log.info('agent.cancelled_pending_selection');
      return { replyText };
    }
    const replyText =
      'Nothing to cancel — there is no pending list or release choice. Ask for a download if you need one.';
    appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
    return { replyText };
  }

  /** Fast-path: movie/series search list picks, or release grab (inline keyboard / 1–5). */
  const numericOnly = /^\s*(\d{1,2})\s*$/.exec(text);
  if (numericOnly) {
    const pending = getPendingAction(telegramUserId, Date.now());
    const choice = Number(numericOnly[1]);
    const idx = choice - 1;
    if (pending?.type === 'movie_search_pick') {
      const item = pending.items[idx];
      if (!item) {
        const replyText = `Invalid choice. Reply with 1-${pending.items.length}.`;
        appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
        return { replyText };
      }
      clearPendingAction(telegramUserId);
      log.info('agent.movie_search_pick', { choice, tmdbId: item.tmdbId });
      return runMoviePreviewForTmdb({
        requestId,
        telegramUserId,
        userText: text,
        tmdbId: item.tmdbId,
        label: item.label,
        log
      });
    }
    if (pending?.type === 'series_search_pick') {
      const item = pending.items[idx];
      if (!item) {
        const replyText = `Invalid choice. Reply with 1-${pending.items.length}.`;
        appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
        return { replyText };
      }
      clearPendingAction(telegramUserId);
      log.info('agent.series_search_pick', { choice, tvdbId: item.tvdbId });
      return runSeriesPreviewForTvdb({
        requestId,
        telegramUserId,
        userText: text,
        tvdbId: item.tvdbId,
        label: item.label,
        log
      });
    }
    if (pending) {
      const item = pending.items[idx];
      if (!item) {
        const replyText = `Invalid choice. Reply with 1-${pending.items.length}.`;
        appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
        return { replyText };
      }
      try {
        await executeTool({
          requestId,
          telegramUserId,
          name: item.toolName,
          rawArguments: JSON.stringify(item.toolArgs),
          userText: text
        });
      } catch (e) {
        if (isHttpError(e)) {
          const replyText = formatHttpErrorForUser(e);
          appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
          return { replyText };
        }
        if (isToolPolicyError(e)) {
          const replyText = e.userMessage;
          appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
          return { replyText };
        }
        throw e;
      }
      const replyText = `Grabbed: ${item.label}`;
      appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
      return { replyText };
    }
    const choiceNum = Number(numericOnly[1]);
    const lastAssistant = getLastAssistantContent(telegramUserId);
    const tmdbFromList =
      lastAssistant != null ? parseTmdbIdFromNumberedMovieList(lastAssistant, choiceNum) : null;
    if (tmdbFromList != null) {
      log.info('agent.movie_pick_from_list', { choice: choiceNum, tmdbId: tmdbFromList });
      const label =
        lastAssistant != null ? extractTitleFromNumberedMovieLine(lastAssistant, choiceNum) : null;
      return runMoviePreviewForTmdb({
        requestId,
        telegramUserId,
        userText: text,
        tmdbId: tmdbFromList,
        label,
        log
      });
    }
    // No release pick and no parsable movie list — let the LLM interpret (e.g. "1" with context).
  }

  if (!numericOnly) {
    const lastAssistant = getLastAssistantContent(telegramUserId);
    if (lastAssistant && looksLikeMovieSearchList(lastAssistant)) {
      const tmdbFromTitle = parseTmdbIdFromListByTitleHint(lastAssistant, text);
      if (tmdbFromTitle != null) {
        log.info('agent.movie_pick_from_list_title', { tmdbId: tmdbFromTitle });
        return runMoviePreviewForTmdb({
          requestId,
          telegramUserId,
          userText: text,
          tmdbId: tmdbFromTitle,
          label: text.trim(),
          log
        });
      }
    }
  }

  const res =
    env.LLM_PROVIDER === 'local_openai_compat'
      ? await runLocalOpenAiCompatChatLoop({ requestId, telegramUserId, userText: text, systemPrompt })
      : await runOpenAiResponsesLoop({ requestId, telegramUserId, userText: text, systemPrompt });

  const replyText = sanitizeAgentReplyText(res.replyText);
  // Hybrid fallback: keep legacy parsing-based registration for models/providers that
  // still emit numbered lists with links. Primary path sets pending actions directly
  // from structured tool results inside the LLM loops.
  const now = Date.now();
  const ttl = 10 * 60_000;
  if (!getPendingAction(telegramUserId, now)) {
    const movieItems = looksLikeMovieSearchList(replyText) ? parseMovieSearchListItems(replyText) : [];
    if (movieItems.length >= 2) {
      setPendingAction(telegramUserId, {
        type: 'movie_search_pick',
        createdAtMs: now,
        expiresAtMs: now + ttl,
        items: movieItems
      });
    } else {
      const seriesItems = looksLikeSeriesSearchList(replyText)
        ? parseSeriesSearchListItems(replyText)
        : [];
      if (seriesItems.length >= 2) {
        setPendingAction(telegramUserId, {
          type: 'series_search_pick',
          createdAtMs: now,
          expiresAtMs: now + ttl,
          items: seriesItems
        });
      }
    }
  }
  appendConversationTurn({ userId: telegramUserId, userText: text, assistantText: replyText });
  log.info('agent.done', { replyTextPreview: replyText.slice(0, 120), provider: env.LLM_PROVIDER });
  return { replyText };
}
