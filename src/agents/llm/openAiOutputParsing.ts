import type { OpenAiFunctionCall, OpenAiMessageOutput } from '../../types/index.js';

type OpenAiOutputItem = OpenAiFunctionCall | OpenAiMessageOutput | { type: string };

type OpenAiOutputTextPart = { type: 'output_text'; text: string };

function isMessageOutput(item: OpenAiOutputItem): item is OpenAiMessageOutput {
  return item.type === 'message';
}

function isOutputTextPart(part: unknown): part is OpenAiOutputTextPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'output_text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

export function extractAssistantText(output: OpenAiOutputItem[]): string {
  for (const item of output) {
    if (!isMessageOutput(item)) continue;

    const partsUnknown: unknown = item.content ?? [];
    const parts = Array.isArray(partsUnknown) ? partsUnknown : [];
    const text = parts.filter(isOutputTextPart).map((p) => p.text).join('');
    if (text.trim().length > 0) return text;
  }
  return '';
}

export function extractFunctionCalls(output: OpenAiOutputItem[]): OpenAiFunctionCall[] {
  return output.filter((i): i is OpenAiFunctionCall => i.type === 'function_call');
}
