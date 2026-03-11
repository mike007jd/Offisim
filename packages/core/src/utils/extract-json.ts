/**
 * Extract a JSON object/array from an LLM response string.
 *
 * Handles multiple LLM output formats:
 * 1. Raw JSON (starts with `{` or `[`)
 * 2. Markdown code blocks (```json ... ```)
 * 3. JSON embedded in natural language (regex extraction)
 *
 * @returns The parsed object, or `null` if extraction/parsing fails.
 */
export function extractJsonFromLlm<T = unknown>(text: string): T | null {
  const trimmed = text.trim();

  // 1. Direct JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Fall through to other strategies
    }
  }

  // 2. Markdown code block: ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // Fall through
    }
  }

  // 3. Embedded JSON object
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch?.[0]) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      // Fall through
    }
  }

  return null;
}
