/**
 * Some local models put raw "functionName(args)" as assistant text instead of natural language.
 * Drop those lines. Identifier must start with lowercase (tool-style) so we do not strip "Title (2025)".
 */
const TOOL_LIKE_LINE =
  /^[a-z][a-zA-Z0-9_]*\s*\([^)]*\)\s*$/;

export function sanitizeAgentReplyText(text: string): string {
  const lines = text.split('\n');
  const kept = lines.filter((line) => !TOOL_LIKE_LINE.test(line.trim()));
  const out = kept.join('\n').trim();
  if (out.length > 0) return out;
  if (text.trim().length > 0 && TOOL_LIKE_LINE.test(text.trim())) {
    return 'Here are the options — if nothing appeared, please ask again in one message.';
  }
  return text;
}
