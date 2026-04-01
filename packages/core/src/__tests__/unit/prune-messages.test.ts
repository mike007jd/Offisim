import { describe, expect, it } from 'vitest';
import type { LlmMessage } from '../../llm/gateway.js';
import { pruneLlmMessages } from '../../llm/prune-messages.js';

function makeMessages(roles: Array<LlmMessage['role']>): readonly LlmMessage[] {
  return roles.map((role, i) => ({ role, content: `msg-${i}` }));
}

describe('pruneLlmMessages', () => {
  it('passes through short arrays unchanged', () => {
    const messages = makeMessages(['system', 'user', 'assistant', 'user', 'assistant']);
    const result = pruneLlmMessages(messages, 50);
    expect(result).toBe(messages); // same reference — no copy made
  });

  it('returns same reference when non-system count exactly equals max', () => {
    const roles: Array<LlmMessage['role']> = [
      'system',
      ...Array<LlmMessage['role']>(50).fill('user'),
    ];
    const messages = makeMessages(roles);
    const result = pruneLlmMessages(messages, 50);
    expect(result).toBe(messages);
  });

  it('keeps all system messages + last 50 non-system when over limit', () => {
    const roles: Array<LlmMessage['role']> = [
      'system',
      'system',
      ...Array<LlmMessage['role']>(60).fill('user'),
    ];
    const messages = makeMessages(roles);
    const result = pruneLlmMessages(messages, 50);

    const systemInResult = result.filter((m) => m.role === 'system');
    const nonSystemInResult = result.filter((m) => m.role !== 'system');

    expect(systemInResult).toHaveLength(2);
    expect(nonSystemInResult).toHaveLength(50);
    expect(result).toHaveLength(52);
  });

  it('preserves message order — system first, then tail of non-system', () => {
    const sys1: LlmMessage = { role: 'system', content: 'sys-a' };
    const sys2: LlmMessage = { role: 'system', content: 'sys-b' };
    const nonSys: LlmMessage[] = Array.from({ length: 55 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn-${i}`,
    }));
    const messages: readonly LlmMessage[] = [sys1, sys2, ...nonSys];

    const result = pruneLlmMessages(messages, 50);

    expect(result[0]).toBe(sys1);
    expect(result[1]).toBe(sys2);
    // First non-system in result is nonSys[5] (the 6th element, 0-indexed)
    expect(result[2]).toBe(nonSys[5]);
    expect(result[result.length - 1]).toBe(nonSys[54]);
  });

  it('edge case: all system messages → unchanged', () => {
    const messages = makeMessages(['system', 'system', 'system']);
    const result = pruneLlmMessages(messages, 50);
    expect(result).toBe(messages);
  });

  it('edge case: 0 messages → empty array', () => {
    const result = pruneLlmMessages([], 50);
    expect(result).toHaveLength(0);
  });

  it('respects custom max parameter', () => {
    const roles: Array<LlmMessage['role']> = [
      'system',
      ...Array<LlmMessage['role']>(10).fill('user'),
    ];
    const messages = makeMessages(roles);
    const result = pruneLlmMessages(messages, 5);

    expect(result.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(result.filter((m) => m.role !== 'system')).toHaveLength(5);
  });

  it('supports trimming all non-system messages when max is zero', () => {
    const messages = makeMessages(['system', 'user', 'assistant', 'user']);
    const result = pruneLlmMessages(messages, 0);

    expect(result).toEqual([{ role: 'system', content: 'msg-0' }]);
  });

  it('supports a synopsis system message while still trimming non-system messages', () => {
    const messages: readonly LlmMessage[] = [
      { role: 'system', content: 'sys' },
      ...Array.from({ length: 9 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `turn-${index}`,
      })),
    ];

    const result = pruneLlmMessages(messages, {
      maxNonSystemMessages: 4,
      synopsisMessage: {
        role: 'system' as const,
        content: '## Conversation synopsis\nEarlier decisions here.',
      },
    });

    expect(result.filter((message) => message.role === 'system')).toHaveLength(2);
    expect(result.filter((message) => message.role !== 'system')).toHaveLength(4);
    expect(result[1]?.content).toContain('Conversation synopsis');
  });

  it('micro-compacts old oversized tool messages while preserving recent tool results', () => {
    const oldTool: LlmMessage = {
      role: 'tool',
      content: 'A'.repeat(120),
      toolCallId: 'tool-old',
    };
    const recentTool: LlmMessage = {
      role: 'tool',
      content: 'B'.repeat(120),
      toolCallId: 'tool-recent',
    };
    const newestTool: LlmMessage = {
      role: 'tool',
      content: 'short',
      toolCallId: 'tool-newest',
    };
    const messages: readonly LlmMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: 'calling tools' },
      oldTool,
      { role: 'user', content: 'continue' },
      recentTool,
      newestTool,
    ];

    const result = pruneLlmMessages(messages, {
      maxNonSystemMessages: 10,
      toolResultKeepRecent: 2,
      toolResultMaxContentChars: 32,
    });

    const compactedOldTool = result[2];
    expect(compactedOldTool?.role).toBe('tool');
    expect(compactedOldTool?.content).toContain('[tool result compacted');
    expect(compactedOldTool?.toolCallId).toBe('tool-old');
    expect(result[4]).toBe(recentTool);
    expect(result[5]).toBe(newestTool);
  });

  it('keeps the same reference when tool micro-compaction is not needed', () => {
    const messages: readonly LlmMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'tool', content: 'small', toolCallId: 'tool-1' },
      { role: 'user', content: 'continue' },
    ];

    const result = pruneLlmMessages(messages, {
      maxNonSystemMessages: 10,
      toolResultKeepRecent: 2,
      toolResultMaxContentChars: 32,
    });

    expect(result).toBe(messages);
  });
});
