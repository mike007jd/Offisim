import { describe, expect, it } from 'vitest';
import { VaultParseError, parseDocument, serializeDocument } from '../../vault/codec.js';

describe('vault/codec', () => {
  it('round-trips frontmatter with stable key ordering', () => {
    const fm = { z: 1, a: 2, m: 'hello' };
    const body = '# Title\n\nHello';
    const text = serializeDocument(fm, body);

    expect(text.startsWith('---\n')).toBe(true);
    // keys must be alphabetically sorted for git-friendly diffs
    const yamlBlock = text.split('---')[1] ?? '';
    const keyOrder = yamlBlock
      .split('\n')
      .map((line) => line.split(':')[0]?.trim())
      .filter((key): key is string => Boolean(key));
    expect(keyOrder).toEqual(['a', 'm', 'z']);

    const parsed = parseDocument(text);
    expect(parsed.frontmatter).toEqual(fm);
    expect(parsed.body.trim()).toBe(body);
  });

  it('normalises windows line endings and trailing whitespace', () => {
    const text = '---\r\nkey: value\r\n---\r\n\r\nbody   \r\n';
    const parsed = parseDocument(text);
    expect(parsed.frontmatter).toEqual({ key: 'value' });
    expect(parsed.body.replace(/\s+$/u, '')).toBe('body');
  });

  it('rejects documents without frontmatter', () => {
    expect(() => parseDocument('no frontmatter here')).toThrow(VaultParseError);
  });

  it('rejects invalid YAML', () => {
    expect(() => parseDocument('---\n: : bad\n---\nbody')).toThrow(VaultParseError);
  });

  it('rejects non-mapping frontmatter', () => {
    expect(() => parseDocument('---\n- list\n- item\n---\n')).toThrow(VaultParseError);
  });
});
