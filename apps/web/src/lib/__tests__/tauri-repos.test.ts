import { describe, expect, it } from 'vitest';

import { createTauriRepositories } from '../tauri-repos';

describe('createTauriRepositories', () => {
  it('exposes agent event and recovery knowledge repositories for runtime parity', () => {
    const repos = createTauriRepositories({} as never);

    expect(repos.agentEvents).toBeDefined();
    expect(repos.recoveryKnowledge).toBeDefined();
    expect(typeof repos.agentEvents?.append).toBe('function');
    expect(typeof repos.agentEvents?.findRecent).toBe('function');
    expect(typeof repos.recoveryKnowledge?.upsert).toBe('function');
    expect(typeof repos.recoveryKnowledge?.findBestFix).toBe('function');
  });
});
