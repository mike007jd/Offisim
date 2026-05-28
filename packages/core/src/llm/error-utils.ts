// Shared error inspection helpers used by every LLM adapter. Capacity / 529
// detection must look past the surface SDK `.message` and dig into the
// network body and any wrapped causes, because OpenAI-compat providers like
// MiniMax frequently return HTTP 200 with an `overloaded_error` payload that
// the SDK presents as a generic "connection error" message.

const MAX_DEPTH = 4;

export function extractErrorText(error: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return '';
  if (error === null || error === undefined) return '';
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return String(error);

  const parts: string[] = [];
  const record = error as Record<string, unknown>;

  if (typeof record.message === 'string') parts.push(record.message);

  // OpenAI SDK / Anthropic SDK both expose `.response` and `.body` for the
  // upstream response. `.errors` carries structured arrays in some shapes.
  for (const key of ['body', 'response', 'data', 'error', 'errors']) {
    const value = record[key];
    if (typeof value === 'string') {
      parts.push(value);
    } else if (typeof value === 'object' && value !== null) {
      parts.push(extractErrorText(value, depth + 1));
    }
  }

  if (record.cause) parts.push(extractErrorText(record.cause, depth + 1));

  return parts.filter(Boolean).join(' | ');
}

const CAPACITY_PATTERN =
  /overloaded_error|overloaded|capacity|server is busy|temporar(?:y|ily) unavailable|rate[ _-]?limit|too many requests/i;

export function isCapacityErrorText(text: string): boolean {
  return CAPACITY_PATTERN.test(text);
}
