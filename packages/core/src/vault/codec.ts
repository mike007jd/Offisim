import { dump, load } from 'js-yaml';

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/u;

export interface ParsedDocument<T> {
  readonly frontmatter: T;
  readonly body: string;
}

export class VaultParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VaultParseError';
  }
}

export function serializeDocument(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = dump(frontmatter, {
    sortKeys: true,
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
  }).trimEnd();
  const normalizedBody = body.replace(/\r\n/gu, '\n').replace(/\s+$/u, '');
  return `---\n${yaml}\n---\n\n${normalizedBody}\n`;
}

export function parseDocument(content: string): { frontmatter: unknown; body: string } {
  const normalized = content.replace(/^\ufeff/u, '').replace(/\r\n/gu, '\n');
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) {
    throw new VaultParseError('Missing YAML frontmatter (expected --- ... --- at start)');
  }
  const [, yamlText = '', bodyText = ''] = match;
  let frontmatter: unknown;
  try {
    frontmatter = load(yamlText);
  } catch (err) {
    throw new VaultParseError('Invalid YAML frontmatter', err);
  }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new VaultParseError('Frontmatter must be a YAML mapping');
  }
  return { frontmatter, body: bodyText };
}
