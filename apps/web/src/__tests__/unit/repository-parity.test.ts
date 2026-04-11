/**
 * Repository parity guard — catches drift across the three hand-written
 * RuntimeRepositories implementations (drizzle / memory / tauri).
 *
 * Drizzle + Tauri are plain object literals whose own keys ARE the interface;
 * Memory uses class instances, so its methods live on the prototype chain and
 * it may also carry implementation-only helpers (`snapshot`, `seed`, `key`,
 * `setActive`, ...). The contract we enforce:
 *
 *   - drizzle ≡ tauri (strict equality at both top level and each sub-repo)
 *   - memory ⊇ drizzle (every interface method must exist; extras allowed)
 *
 * Calling each factory with a stub db is safe because nothing touches the db
 * until a method body runs. We only reflect the returned shape.
 */
import { describe, expect, it } from 'vitest';
// Relative dist paths (not `@offisim/core/*`) because the vitest alias for
// `@offisim/core` is a string prefix match that swallows subpath imports like
// `@offisim/core/drizzle`. See vitest.config.ts.
import { createDrizzleRepositories } from '../../../../../packages/core/dist/drizzle.js';
import { createMemoryRepositories } from '../../../../../packages/core/dist/runtime/memory-repositories.js';
import { createTauriRepositories } from '../../lib/tauri-repos.js';

type ReposShape = Record<string, unknown>;

// Proxy target is `function () {}` (not `{}`) so both `get` and `apply` traps
// cover any `db.foo.bar()` chain a factory might accidentally call during
// construction. Factories currently never call into the db at construction
// time — this is belt-and-braces.
const STUB_DB = new Proxy(() => {}, {
  get: () => STUB_DB,
  apply: () => STUB_DB,
  // biome-ignore lint/suspicious/noExplicitAny: stub db for reflection only
}) as any;

const drizzleRepos = createDrizzleRepositories(STUB_DB) as unknown as ReposShape;
const memoryRepos = createMemoryRepositories() as unknown as ReposShape;
const tauriRepos = createTauriRepositories(STUB_DB) as unknown as ReposShape;

function collectTopLevelKeys(repos: ReposShape): string[] {
  return Object.entries(repos)
    .filter(([, value]) => value !== null && typeof value === 'object')
    .map(([key]) => key)
    .sort();
}

function collectSubRepoMethods(subRepo: object): string[] {
  const methods = new Set<string>();

  for (const key of Object.keys(subRepo)) {
    if (typeof (subRepo as Record<string, unknown>)[key] === 'function') {
      methods.add(key);
    }
  }

  // Walk the prototype chain for class-instance sub-repos (memory). Use
  // descriptors instead of `proto[key]` so accidental getters — if someone
  // ever adds one — don't fire during reflection.
  let proto = Object.getPrototypeOf(subRepo);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (descriptor && typeof descriptor.value === 'function') {
        methods.add(key);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  return [...methods].sort();
}

// Precompute once at module load: reflection is deterministic and there is
// no reason to re-walk prototype chains in every it() block.
const CANONICAL_KEYS = collectTopLevelKeys(drizzleRepos);
const TAURI_KEYS = collectTopLevelKeys(tauriRepos);
const MEMORY_KEY_SET = new Set(collectTopLevelKeys(memoryRepos));

function methodsByRepo(repos: ReposShape): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const key of CANONICAL_KEYS) {
    const subRepo = repos[key];
    if (subRepo === null || typeof subRepo !== 'object') {
      expect.fail(`${key} is missing or not an object in one implementation`);
    }
    map.set(key, collectSubRepoMethods(subRepo));
  }
  return map;
}

const DRIZZLE_METHODS = methodsByRepo(drizzleRepos);
const TAURI_METHODS = methodsByRepo(tauriRepos);
const MEMORY_METHODS = methodsByRepo(memoryRepos);

describe('RuntimeRepositories parity', () => {
  it('drizzle and tauri expose the same set of sub-repositories', () => {
    expect(TAURI_KEYS).toEqual(CANONICAL_KEYS);
  });

  it('memory implements every sub-repository from the canonical shape', () => {
    const missing = CANONICAL_KEYS.filter((key) => !MEMORY_KEY_SET.has(key));
    expect(missing).toEqual([]);
  });

  for (const repoKey of CANONICAL_KEYS) {
    it(`${repoKey} stays in sync across drizzle/tauri/memory`, () => {
      const drizzleMethods = DRIZZLE_METHODS.get(repoKey) ?? [];
      const tauriMethods = TAURI_METHODS.get(repoKey) ?? [];
      const memoryMethods = MEMORY_METHODS.get(repoKey) ?? [];

      expect(tauriMethods).toEqual(drizzleMethods);

      const memorySet = new Set(memoryMethods);
      const missing = drizzleMethods.filter((name) => !memorySet.has(name));
      expect(missing).toEqual([]);
    });
  }
});
