// ESM loader hook: replace the renderer's `data/adapters.js` with an in-memory
// fake so the chat-persistence data layer (`chat-message-events.ts` →
// `thread-message-events.ts` → `reposOrNull`) can be exercised in Node without
// the Tauri SQL plugin. The fake's repos are seeded from a global the harness
// installs before importing the data layer, so each scenario gets a fresh
// MemoryAgentEventRepository-backed store.

const FAKE_SCHEME = 'offisim-fake-adapters:';

export async function resolve(specifier, context, nextResolve) {
  // Intercept any import that lands on the renderer data/adapters module
  // (relative `./adapters.js`, alias `@/data/adapters.js`, or absolute).
  if (specifier.endsWith('/adapters.js') || specifier.endsWith('/adapters.ts')) {
    const resolved = await nextResolve(specifier, context).catch(() => null);
    const url = resolved?.url ?? '';
    if (url.endsWith('data/adapters.ts') || url.endsWith('data/adapters.js')) {
      return { url: `${FAKE_SCHEME}adapters`, shortCircuit: true };
    }
    if (resolved) return resolved;
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === `${FAKE_SCHEME}adapters`) {
    const source = `
      export function isTauriRuntime() { return true; }
      export async function reposOrNull() {
        const hook = globalThis.__OFFISIM_FAKE_REPOS__;
        if (!hook) return null;
        return hook();
      }
    `;
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
