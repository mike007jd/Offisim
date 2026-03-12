import { describe, expect, it } from 'vitest';
import { generateId } from '../../utils/generate-id.js';

describe('generateId', () => {
  it('produces prefixed IDs', () => {
    const id = generateId('emp');
    expect(id).toMatch(/^emp-/);
  });

  it('produces IDs with sufficient length (UUID-like after prefix)', () => {
    const id = generateId('x');
    // 'x-' + UUID = 'x-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' = 38 chars
    expect(id.length).toBeGreaterThanOrEqual(30);
  });

  it('never produces duplicate IDs in 10000 iterations', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      ids.add(generateId('t'));
    }
    expect(ids.size).toBe(10_000);
  });

  it('does not contain raw 13-digit timestamp', () => {
    const id = generateId('t');
    const parts = id.split('-');
    const hasRawTimestamp = parts.some((p) => /^\d{13}$/.test(p));
    expect(hasRawTimestamp).toBe(false);
  });
});
