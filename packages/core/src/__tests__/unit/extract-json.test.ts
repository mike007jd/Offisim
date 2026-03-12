import { describe, expect, it } from 'vitest';
import { extractJsonFromLlm } from '../../utils/extract-json.js';

describe('extractJsonFromLlm', () => {
  it('extracts clean JSON object', () => {
    expect(extractJsonFromLlm('{"a":1}')).toEqual({ a: 1 });
  });

  it('extracts JSON from markdown code fence', () => {
    expect(extractJsonFromLlm('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts first JSON object when multiple exist (non-greedy)', () => {
    const input = 'Here is result: {"a":1} and also {"b":2}';
    expect(extractJsonFromLlm(input)).toEqual({ a: 1 });
  });

  it('extracts JSON array', () => {
    expect(extractJsonFromLlm('Result: [1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns null for no JSON', () => {
    expect(extractJsonFromLlm('Hello world')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractJsonFromLlm('')).toBeNull();
  });

  it('handles nested braces correctly', () => {
    const input = 'text {"a":{"b":{"c":1}}} more text';
    expect(extractJsonFromLlm(input)).toEqual({ a: { b: { c: 1 } } });
  });

  it('handles strings containing braces', () => {
    const input = 'text {"code": "if (x) { return }"} end';
    expect(extractJsonFromLlm(input)).toEqual({ code: 'if (x) { return }' });
  });

  it('preserves generic type parameter', () => {
    interface Custom {
      x: number;
    }
    const result = extractJsonFromLlm<Custom>('{"x": 42}');
    expect(result?.x).toBe(42);
  });
});
