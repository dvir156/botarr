import { z } from 'zod';
import { OpenAiClient, type OpenAiInputItem } from '../../clients/openaiClient.js';
import { getAgentEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { formatHttpErrorForUser, isHttpError } from '../../util/httpErrorMessage.js';
import { toolDefinitions } from '../toolDefinitions.js';
import { executeTool } from '../executeMediaTool.js';
import { getConversationTurns } from '../conversationHistory.js';
import { priorTurnsToOpenAiInput } from './priorTurns.js';
import { extractAssistantText, extractFunctionCalls } from './openAiOutputParsing.js';
import { isToolPolicyError, type MediaAgentResponse, type SearchMovieResult, type SearchSeriesResult, type ToolName } from '../../types/index.js';
import { setPendingAction } from '../pendingActions.js';
import { formatMovieSearchMatchesReply, formatSeriesSearchMatchesReply } from '../movieDisambiguationPick.js';

async function runToolWithHttpHandling(args: {
  requestId: string;
  telegramUserId: number;
  name: ToolName;
  rawArguments: string;
  userText: string;
}): Promise<{ ok: true; result: unknown } | { ok: false; replyText: string }> {
  try {
    const result = await executeTool({
      requestId: args.requestId,
      telegramUserId: args.telegramUserId,
      name: args.name,
      rawArguments: args.rawArguments,
      userText: args.userText
    });
    return { ok: true, result };
  } catch (e) {
    if (isHttpError(e)) {
      return { ok: false, replyText: formatHttpErrorForUser(e) };
    }
    if (isToolPolicyError(e)) {
      return { ok: false, replyText: e.userMessage };
    }
    throw e;
  }
}

export async function runOpenAiResponsesLoop(args: {
  requestId: string;
  telegramUserId: number;
  userText: string;
  systemPrompt: string;
}): Promise<MediaAgentResponse> {
  const client = new OpenAiClient();
  const prior = getConversationTurns(args.telegramUserId);
  const conversation: OpenAiInputItem[] = [
    { role: 'system', content: [{ type: 'input_text', text: args.systemPrompt }] },
    ...priorTurnsToOpenAiInput(prior),
    { role: 'user', content: [{ type: 'input_text', text: args.userText }] }
  ];

  const maxSteps = 6;
  let lastIterationHadToolCalls = false;

  for (let step = 0; step < maxSteps; step++) {
    const response = await client.createResponse({
      model: getAgentEnv().LLM_MODEL,
      input: conversation,
      tools: toolDefinitions
    });

    const functionCalls = extractFunctionCalls(response.output);
    const assistantText = extractAssistantText(response.output);
    lastIterationHadToolCalls = functionCalls.length > 0;

    if (functionCalls.length === 0) {
      const replyText =
        assistantText.trim().length > 0 ? assistantText.trim() : 'Sorry — I could not produce a response.';
      return { replyText };
    }

    for (const call of functionCalls) {
      const toolOutcome = await runToolWithHttpHandling({
        requestId: args.requestId,
        telegramUserId: args.telegramUserId,
        name: call.name,
        rawArguments: call.arguments,
        userText: args.userText
      });
      if (!toolOutcome.ok) {
        return { replyText: toolOutcome.replyText };
      }
      const toolResult = toolOutcome.result;

      // Bot-owned UI: short-circuit on disambiguation searches and render deterministically.
      if (call.name === 'searchMovie') {
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
      if (call.name === 'searchSeries') {
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

      conversation.push({
        type: 'function_call',
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments
      });
      conversation.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(toolResult)
      });

      if (call.name === 'checkAvailabilityInPlex') {
        const parsed = z.object({ available: z.boolean() }).safeParse(toolResult);
        if (parsed.success && parsed.data.available) {
          return { replyText: 'already available' };
        }
      }
    }
  }

  logger.child({ requestId: args.requestId }).warn('llm.loop.step_limit', {
    provider: 'openai_responses',
    maxSteps,
    lastIterationHadToolCalls
  });
  const replyText = lastIterationHadToolCalls
    ? 'Sorry — this needed too many tool steps to finish. Try a shorter request or split it into two messages.'
    : 'Sorry — I could not finish that request. Please rephrase or try again.';
  return { replyText };
}
