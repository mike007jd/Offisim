import { describe, expect, it } from 'vitest';
import { UserPreferenceMiddleware } from '../../middleware/builtin/user-preference-middleware.js';
import type { LlmCallContext } from '../../middleware/types.js';
import { MemoryUserPreferenceRepository } from '../../repositories/memory-user-preference-repository.js';

function makeCtx(repo: MemoryUserPreferenceRepository, companyId = 'c-1'): LlmCallContext {
  return {
    request: {
      messages: [
        { role: 'system', content: 'You are the Boss AI.' },
        { role: 'user', content: 'Help me build something' },
      ],
      model: 'test-model',
    },
    runtimeCtx: {
      companyId,
      threadId: 't-1',
      repos: { userPreferences: repo },
    } as unknown as LlmCallContext['runtimeCtx'],
    meta: { nodeName: 'boss', provider: 'test', model: 'test-model' },
    extras: {},
  };
}

describe('UserPreferenceMiddleware', () => {
  it('injects preferences into the system message', async () => {
    const repo = new MemoryUserPreferenceRepository();
    await repo.create({
      preference_id: 'up-1',
      company_id: 'c-1',
      category: 'preference',
      content: 'User prefers concise reports',
      confidence: 0.9,
      importance: 0.8,
      source: 'explicit',
    });

    const mw = new UserPreferenceMiddleware(repo);
    const ctx = makeCtx(repo);
    expect(mw.before).toBeDefined();
    const result = await mw.before(ctx);

    const systemMsg = result.request.messages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('User prefers concise reports');
    expect(systemMsg?.content).toContain('[User preferences');
  });

  it('does nothing when no preferences exist', async () => {
    const repo = new MemoryUserPreferenceRepository();
    const mw = new UserPreferenceMiddleware(repo);
    const ctx = makeCtx(repo);

    expect(mw.before).toBeDefined();
    const result = await mw.before(ctx);
    expect(result).toBe(ctx); // Unchanged
  });

  it('limits injection by character count', async () => {
    const repo = new MemoryUserPreferenceRepository();

    // Create many preferences
    for (let i = 0; i < 50; i++) {
      await repo.create({
        preference_id: `up-${i}`,
        company_id: 'c-1',
        category: 'preference',
        content: `Preference number ${i} with some longer text to fill up space and test truncation behavior`,
        confidence: 0.8,
        importance: 0.7,
        source: 'inferred',
      });
    }

    const mw = new UserPreferenceMiddleware(repo);
    const ctx = makeCtx(repo);
    expect(mw.before).toBeDefined();
    const result = await mw.before(ctx);

    const systemMsg = result.request.messages.find((m) => m.role === 'system');
    // Should contain preferences but not exceed 2000 chars injection
    expect(systemMsg?.content).toContain('[User preferences');
    // The injection part should be bounded
    if (!systemMsg) throw new Error('Expected system message');
    const injectionStart = systemMsg.content.indexOf('[User preferences');
    const injectionPart = systemMsg.content.slice(injectionStart);
    expect(injectionPart.length).toBeLessThan(2200); // Some tolerance for the header
  });

  it('has correct priority (50)', () => {
    const repo = new MemoryUserPreferenceRepository();
    const mw = new UserPreferenceMiddleware(repo);
    expect(mw.priority).toBe(50);
    expect(mw.name).toBe('user-preference');
  });
});
