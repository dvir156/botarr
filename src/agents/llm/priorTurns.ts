import type { OpenAiInputItem } from '../../clients/openaiClient.js';
import type { ChatMessage } from '../../clients/localLlmChatClient.js';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

export function priorTurnsToOpenAiInput(prior: ConversationTurn[]): OpenAiInputItem[] {
  return prior.map((t) => ({
    role: t.role,
    content: [{ type: 'input_text', text: t.content }]
  }));
}

export function priorTurnsToChatMessages(prior: ConversationTurn[]): ChatMessage[] {
  return prior.map((t) =>
    t.role === 'user'
      ? { role: 'user' as const, content: t.content }
      : { role: 'assistant' as const, content: t.content }
  );
}
