/** Telegram message text limit (Bot API). */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Split a string into chunks safe to send as Telegram messages.
 * Tries to break on newlines; falls back to hard splits.
 */
export function chunkTelegramText(text: string, maxLen = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= maxLen) {
      chunks.push(rest);
      break;
    }
    let slice = rest.slice(0, maxLen);
    const nl = slice.lastIndexOf('\n');
    if (nl > maxLen * 0.6) {
      slice = slice.slice(0, nl + 1);
    }
    chunks.push(slice);
    rest = rest.slice(slice.length);
  }
  return chunks;
}
