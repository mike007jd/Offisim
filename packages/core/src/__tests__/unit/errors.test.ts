import { describe, expect, it } from 'vitest';
import { AicsError, DataError, GraphError, LlmError } from '../../errors.js';

describe('AicsError', () => {
  it('has code and recoverable properties', () => {
    const err = new AicsError('test', 'TEST_CODE', true);
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.recoverable).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('LlmError', () => {
  it('marks 429 as recoverable', () => {
    const err = new LlmError('rate limited', 'anthropic', 429);
    expect(err.recoverable).toBe(true);
    expect(err.provider).toBe('anthropic');
    expect(err.code).toBe('LLM_ERROR');
  });

  it('marks 500 as recoverable', () => {
    const err = new LlmError('server error', 'openai', 500);
    expect(err.recoverable).toBe(true);
  });

  it('marks 400 as not recoverable', () => {
    const err = new LlmError('bad request', 'anthropic', 400);
    expect(err.recoverable).toBe(false);
  });

  it('marks unknown status as not recoverable', () => {
    const err = new LlmError('unknown', 'openai');
    expect(err.recoverable).toBe(false);
  });

  it('does not mark 431 as recoverable', () => {
    const err = new LlmError('too large', 'test', 431);
    expect(err.recoverable).toBe(false);
  });

  it('marks 529 as recoverable', () => {
    const err = new LlmError('overloaded', 'test', 529);
    expect(err.recoverable).toBe(true);
  });
});

describe('GraphError', () => {
  it('captures node name', () => {
    const err = new GraphError('node failed', 'boss');
    expect(err.nodeName).toBe('boss');
    expect(err.recoverable).toBe(false);
  });
});

describe('DataError', () => {
  it('is not recoverable', () => {
    const err = new DataError('write failed');
    expect(err.recoverable).toBe(false);
    expect(err.code).toBe('DATA_ERROR');
  });
});
