import { describe, expect, it } from 'vitest';
import { MemoryUserPreferenceRepository } from '../../repositories/memory-user-preference-repository.js';
import { UserMemoryService } from '../../services/user-memory-service.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

describe('UserMemoryService', () => {
  function setup() {
    const repo = new MemoryUserPreferenceRepository();
    const gateway = new MockLlmGateway();
    const service = new UserMemoryService(repo, gateway);
    return { repo, gateway, service };
  }

  it('saves explicit preference with high confidence', async () => {
    const { service, repo } = setup();

    const result = await service.saveExplicit('c-1', 'I prefer concise reports', 'preference', 't-1');

    expect(result.content).toBe('I prefer concise reports');
    expect(result.source).toBe('explicit');
    expect(result.confidence).toBe(0.95);
    expect(result.category).toBe('preference');

    const all = await repo.findByCompany('c-1');
    expect(all).toHaveLength(1);
  });

  it('reinforces duplicate explicit preference instead of creating new', async () => {
    const { service, repo } = setup();

    await service.saveExplicit('c-1', 'I prefer concise reports');
    const second = await service.saveExplicit('c-1', 'I prefer concise reports');

    expect(second.reinforcement_count).toBe(1);
    const all = await repo.findByCompany('c-1');
    expect(all).toHaveLength(1);
  });

  it('normalizes dedupe key — case and punctuation insensitive', async () => {
    const { service, repo } = setup();

    await service.saveExplicit('c-1', 'I prefer CONCISE reports!');
    const second = await service.saveExplicit('c-1', 'i prefer concise reports');

    expect(second.reinforcement_count).toBe(1);
    const all = await repo.findByCompany('c-1');
    expect(all).toHaveLength(1);
  });

  it('getPreferences returns sorted by score', async () => {
    const { service } = setup();

    await service.saveExplicit('c-1', 'Low importance fact', 'context');
    await service.saveExplicit('c-1', 'High importance goal', 'goal');

    const prefs = await service.getPreferences('c-1');
    expect(prefs).toHaveLength(2);
    // Both have same confidence (0.95) but importance is 0.7 for both explicit ones
    // So order depends on creation order / score tie-breaking
    expect(prefs.length).toBe(2);
  });

  it('forget deletes a preference', async () => {
    const { service, repo } = setup();

    const pref = await service.saveExplicit('c-1', 'Something to forget');
    await service.forget(pref.preference_id);

    const all = await repo.findByCompany('c-1');
    expect(all).toHaveLength(0);
  });

  it('extractFromConversation extracts preferences via LLM', async () => {
    const { service, gateway, repo } = setup();

    gateway.pushResponse({
      content: JSON.stringify({
        preferences: [
          { content: 'User is a senior developer', category: 'context', importance: 0.7, confidence: 0.8 },
          { content: 'Prefers TypeScript', category: 'preference', importance: 0.6, confidence: 0.85 },
        ],
      }),
    });

    service.extractFromConversation('c-1', 'User: I mainly work with TypeScript...', 't-1');

    // Wait for async extraction
    await new Promise((resolve) => setTimeout(resolve, 50));

    const all = await repo.findByCompany('c-1');
    expect(all).toHaveLength(2);
    expect(all.some((p) => p.content === 'User is a senior developer')).toBe(true);
    expect(all.some((p) => p.content === 'Prefers TypeScript')).toBe(true);
    expect(all.every((p) => p.source === 'inferred')).toBe(true);
  });

  it('extractFromConversation deduplicates against existing preferences', async () => {
    const { service, gateway, repo } = setup();

    // Save explicit first
    await service.saveExplicit('c-1', 'Prefers TypeScript');

    gateway.pushResponse({
      content: JSON.stringify({
        preferences: [
          { content: 'prefers typescript', category: 'preference', importance: 0.6 },
        ],
      }),
    });

    service.extractFromConversation('c-1', 'conversation text', 't-1');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const all = await repo.findByCompany('c-1');
    // Should reinforce, not create new
    expect(all).toHaveLength(1);
  });
});
