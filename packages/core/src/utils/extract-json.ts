/**
 * Extract a JSON object/array from an LLM response string.
 *
 * Handles multiple LLM output formats:
 * 1. Raw JSON (starts with `{` or `[`)
 * 2. Markdown code blocks (```json ... ```)
 * 3. Balanced-brace extraction from natural language (non-greedy, handles nesting + string escapes)
 *
 * @returns The parsed object, or `null` if extraction/parsing fails.
 */
export function extractJsonFromLlm<T = unknown>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Direct JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Fall through to other strategies
    }
  }

  // 2. Markdown code block: ```json ... ``` or ``` ... ```
  const fenceStart = trimmed.indexOf('```');
  if (fenceStart >= 0) {
    let contentStart = fenceStart + 3;
    if (trimmed.slice(contentStart, contentStart + 4).toLowerCase() === 'json') {
      contentStart += 4;
    }
    while (/\s/u.test(trimmed[contentStart] ?? '')) contentStart += 1;
    const fenceEnd = trimmed.indexOf('```', contentStart);
    const codeBlock = fenceEnd >= 0 ? trimmed.slice(contentStart, fenceEnd).trim() : '';
    try {
      if (codeBlock) return JSON.parse(codeBlock) as T;
    } catch {
      // Fall through
    }
  }

  // 3. Balanced-brace extraction (non-greedy, handles nested + string escapes)
  return extractBalanced<T>(trimmed, '{', '}') ?? extractBalanced<T>(trimmed, '[', ']');
}

function extractBalanced<T>(text: string, open: string, close: string): T | null {
  const start = text.indexOf(open);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaping = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (isEscaping) {
      isEscaping = false;
      continue;
    }
    if (ch === '\\' && inString) {
      isEscaping = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
