import { z, ZodError } from 'zod';
import { LocalLlmChatClient, type ChatMessage, type ChatToolCall } from '../../clients/localLlmChatClient.js';
import { getAgentEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { MediaAgentResponse, SearchMovieResult, SearchSeriesResult } from '../../types/index.js';
import { isToolName, isToolPolicyError, type ToolName } from '../../types/index.js';
import { formatHttpErrorForUser, isHttpError } from '../../util/httpErrorMessage.js';
import { toolDefinitions } from '../toolDefinitions.js';
import { executeTool } from '../executeMediaTool.js';
import { getConversationTurns } from '../conversationHistory.js';
import { priorTurnsToChatMessages } from './priorTurns.js';
import { setPendingAction } from '../pendingActions.js';
import { formatMovieSearchMatchesReply, formatSeriesSearchMatchesReply } from '../movieDisambiguationPick.js';

function chatToolCallToInternal(tc: ChatToolCall): { id: string; name: ToolName; arguments: string } {
  const name = tc.function.name;
  if (!isToolName(name)) {
    throw new Error(`Unknown tool from model: ${name}`);
  }
  return { id: tc.id, name, arguments: tc.function.arguments ?? '{}' };
}

async function runToolWithHttpHandling(args: {
  requestId: string;
  telegramUserId: number;
  name: ToolName;
  rawArguments: string;
  userText: string;
}): Promise<{ ok: true; result: unknown } | { ok: false; replyText: string }> {
  const log = logger.child({ requestId: args.requestId, tool: args.name });
  try {
    log.info('tool.call', {
      rawArgumentsPreview: (args.rawArguments ?? '').slice(0, 500)
    });
    const result = await executeTool({
      requestId: args.requestId,
      telegramUserId: args.telegramUserId,
      name: args.name,
      rawArguments: args.rawArguments,
      userText: args.userText
    });
    log.info('tool.ok');
    return { ok: true, result };
  } catch (e) {
    if (isHttpError(e)) {
      log.error('tool.http_error', {
        status: e.status,
        method: e.method,
        url: e.url
      });
      return { ok: false, replyText: formatHttpErrorForUser(e) };
    }
    if (isToolPolicyError(e)) {
      log.warn('tool.policy_blocked', { reason: e.message });
      return { ok: false, replyText: e.userMessage };
    }
    if (e instanceof ZodError) {
      log.warn('tool.validation_failed', {
        issues: e.issues.map((i) => ({
          path: i.path,
          message: i.message,
          code: i.code
        }))
      });
      return {
        ok: false,
        replyText:
          'Sorry — I could not understand that tool call (missing or invalid inputs). Please try again with the full movie/show title.'
      };
    }
    log.error('tool.unhandled_error', { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export async function runLocalOpenAiCompatChatLoop(args: {
  requestId: string;
  telegramUserId: number;
  userText: string;
  systemPrompt: string;
}): Promise<MediaAgentResponse> {
  const env = getAgentEnv();
  const client = new LocalLlmChatClient();
  const prior = getConversationTurns(args.telegramUserId);
  const messages: ChatMessage[] = [
    { role: 'system', content: args.systemPrompt },
    ...priorTurnsToChatMessages(prior),
    { role: 'user', content: args.userText }
  ];

  const maxSteps = 8;
  let lastIterationHadToolCalls = false;

  for (let step = 0; step < maxSteps; step++) {
    const res = await client.createChatCompletion({
      model: env.LLM_MODEL,
      messages,
      tools: toolDefinitions
    });

    const choice = res.choices[0];
    const msg = choice?.message;
    if (!msg) return { replyText: 'Sorry — I could not produce a response.' };

    const toolCalls = msg.tool_calls ?? [];
    const content = (msg.content ?? '').trim();
    lastIterationHadToolCalls = toolCalls.length > 0;

    if (toolCalls.length === 0) {
      return { replyText: content.length > 0 ? content : 'Sorry — I could not produce a response.' };
    }

    messages.push({
      role: 'assistant',
      content: content.length > 0 ? content : null,
      tool_calls: toolCalls
    });

    for (const tc of toolCalls) {
      const c = chatToolCallToInternal(tc);
      const toolOutcome = await runToolWithHttpHandling({
        requestId: args.requestId,
        telegramUserId: args.telegramUserId,
        name: c.name,
        rawArguments: c.arguments,
        userText: args.userText
      });
      if (!toolOutcome.ok) {
        return { replyText: toolOutcome.replyText };
      }
      const toolResult = toolOutcome.result;

      // Bot-owned UI: short-circuit on disambiguation searches and render deterministically.
      if (c.name === 'searchMovie') {
        const res = toolResult as SearchMovieResult;
        const items = (res.matches ?? []).slice(0, 10).map((m) => {
          const year = m.year != null ? ` (${m.year})` : '';
          return { tmdbId: m.tmdbId, label: `${m.title}${year}` };
        });
        const now = Date.now();
        if (items.length >= 2) {
          setPendingAction(args.telegramUserId, {
            type: 'movie_search_pick',
            createdAtMs: now,
            expiresAtMs: now + 10 * 60_000,
            items
          });
        }
        return { replyText: formatMovieSearchMatchesReply(res) };
      }
      if (c.name === 'searchSeries') {
        const res = toolResult as SearchSeriesResult;
        const items = (res.matches ?? []).slice(0, 10).map((m) => {
          const year = m.year != null ? ` (${m.year})` : '';
          return { tvdbId: m.tvdbId, label: `${m.title}${year}` };
        });
        const now = Date.now();
        if (items.length >= 2) {
          setPendingAction(args.telegramUserId, {
            type: 'series_search_pick',
            createdAtMs: now,
            expiresAtMs: now + 10 * 60_000,
            items
          });
        }
        return { replyText: formatSeriesSearchMatchesReply(res) };
      }

      messages.push({
        role: 'tool',
        tool_call_id: c.id,
        content: JSON.stringify(toolResult)
      });

      if (c.name === 'checkAvailabilityInPlex') {
        const parsed = z.object({ available: z.boolean() }).safeParse(toolResult);
        if (parsed.success && parsed.data.available) {
          return { replyText: 'already available' };
        }
      }
    }
  }

  logger.child({ requestId: args.requestId }).warn('llm.loop.step_limit', {
    provider: 'local_openai_compat',
    maxSteps,
    lastIterationHadToolCalls
  });
  const replyText = lastIterationHadToolCalls
    ? 'Sorry — this needed too many tool steps to finish. Try a shorter request or split it into two messages.'
    : 'Sorry — I could not finish that request. Please rephrase or try again.';
  return { replyText };
}
