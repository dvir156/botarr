/**
 * Runs async work for a given Telegram user strictly one-at-a-time, so in-memory agent
 * state (pending picks, conversation history) cannot interleave across concurrent updates.
 */
const tails = new Map<number, Promise<unknown>>();

export function runSerializedForUser<T>(telegramUserId: number, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(telegramUserId) ?? Promise.resolve();
  const next = prev.then(() => fn());
  tails.set(
    telegramUserId,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}
