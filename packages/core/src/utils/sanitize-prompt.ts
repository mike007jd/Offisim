/**
 * Sanitize user-controllable text before interpolating it into a system prompt.
 *
 * Defence-in-depth: strips lines that look like prompt injection attempts
 * and enforces a character length limit.
 */

/** Patterns that indicate prompt injection attempts (case-insensitive, line-start). */
const INJECTION_PATTERNS = [
  /^\s*system\s*:/i,
  /^\s*you are\b/i,
  /^\s*ignore all\b/i,
  /^\s*forget your\b/i,
  /^\s*disregard\b/i,
  /^\s*override\b/i,
  /^\s*new instructions?\s*:/i,
];

/**
 * Sanitize a user-controllable string for safe prompt interpolation.
 *
 * - Strips lines matching known injection patterns
 * - Truncates to `maxLength` characters
 * - Returns the cleaned text (may be empty string)
 */
export function sanitizeForPrompt(text: string, maxLength: number): string {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned = lines.filter((line) => !INJECTION_PATTERNS.some((re) => re.test(line)));
  const joined = cleaned.join('\n').trim();
  if (joined.length <= maxLength) return joined;
  return `${joined.slice(0, maxLength)}…`;
}
