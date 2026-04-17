/** Last N user/assistant turns per Telegram user (in-memory). */

const MAX_TURNS = 8;
const store = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>();

export function getConversationTurns(userId: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  return store.get(userId) ?? [];
}

export function appendConversationTurn(args: {
  userId: number;
  userText: string;
  assistantText: string;
}): void {
  const arr = store.get(args.userId) ?? [];
  arr.push({ role: 'user', content: args.userText });
  arr.push({ role: 'assistant', content: args.assistantText });
  const maxMessages = MAX_TURNS * 2;
  while (arr.length > maxMessages) {
    arr.splice(0, 2);
  }
  store.set(args.userId, arr);
}
