/** Shared renderer-side credential redaction used before any durable projection. */
const SECRET_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\b[sr]k-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pohsr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

const URL_CREDENTIALS_RE = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;
const SECRET_ASSIGNMENT_RE =
  /\b(authorization|bearer|token|api[_-]?key|secret|password|access[_-]?token)(\s*[:=]\s*)("?)([^"\s,;}]+)\3/gi;
const PERSONAL_INFORMATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:\+?\d[\d ().-]{8,}\d)\b/u,
];

export function redactSecrets(text: string): string {
  let redacted = text.replace(URL_CREDENTIALS_RE, '$1[REDACTED]@');
  redacted = redacted.replace(SECRET_ASSIGNMENT_RE, '$1$2[REDACTED]');
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

export function containsSensitiveText(text: string): boolean {
  return (
    redactSecrets(text) !== text ||
    PERSONAL_INFORMATION_PATTERNS.some((pattern) => pattern.test(text))
  );
}
