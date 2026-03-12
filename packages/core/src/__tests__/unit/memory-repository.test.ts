import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryMemoryRepository } from '../../repositories/memory-memory-repository.js';
import type { MemoryEntryCreate } from '../../runtime/repositories.js';

const COMPANY_ID = 'c-test-1';

function makeEntry(overrides?: Partial<MemoryEntryCreate>): MemoryEntryCreate {
  return {
    memory_id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    company_id: COMPANY_ID,
    scope: 'employee',
    owner_id: 'e-dev-1',
    category: 'experience',
    content: 'TypeScript generics are useful for type-safe containers',
    importance: 0.7,
    ...overrides,
  };
}

describe('InMemoryMemoryRepository', () => {
  let repo: InMemoryMemoryRepository;

  beforeEach(() => {
    repo = new InMemoryMemoryRepository();
  });

  it('creates and retrieves a memory entry', async () => {
    const entry = makeEntry({ memory_id: 'mem-1' });
    const created = await repo.create(entry);

    expect(created.memory_id).toBe('mem-1');
    expect(created.content).toBe(entry.content);
    expect(created.scope).toBe('employee');
    expect(created.access_count).toBe(0);
    expect(created.created_at).toBeTruthy();

    const found = await repo.findById('mem-1');
    expect(found).not.toBeNull();
    expect(found!.content).toBe(entry.content);
  });

  it('returns null for non-existent memory', async () => {
    const result = await repo.findById('non-existent');
    expect(result).toBeNull();
  });

  it('deletes a memory entry', async () => {
    await repo.create(makeEntry({ memory_id: 'mem-del' }));
    await repo.delete('mem-del');
    const result = await repo.findById('mem-del');
    expect(result).toBeNull();
  });

  it('searches by query (case-insensitive substring)', async () => {
    await repo.create(makeEntry({ memory_id: 'mem-ts', content: 'TypeScript is great' }));
    await repo.create(makeEntry({ memory_id: 'mem-py', content: 'Python is also great' }));
    await repo.create(
      makeEntry({ memory_id: 'mem-other', content: 'Rust is fast', company_id: 'c-other' }),
    );

    const results = await repo.search('typescript', { companyId: COMPANY_ID });
    expect(results).toHaveLength(1);
    expect(results[0]!.memory_id).toBe('mem-ts');
  });

  it('search respects scope and ownerId filters', async () => {
    await repo.create(
      makeEntry({ memory_id: 'mem-e1', scope: 'employee', owner_id: 'e-1', content: 'foo bar' }),
    );
    await repo.create(
      makeEntry({ memory_id: 'mem-e2', scope: 'employee', owner_id: 'e-2', content: 'foo baz' }),
    );
    await repo.create(
      makeEntry({
        memory_id: 'mem-co',
        scope: 'company',
        owner_id: 'c-test-1',
        content: 'foo qux',
      }),
    );

    const scopeFiltered = await repo.search('foo', {
      companyId: COMPANY_ID,
      scope: 'employee',
    });
    expect(scopeFiltered).toHaveLength(2);

    const ownerFiltered = await repo.search('foo', {
      companyId: COMPANY_ID,
      scope: 'employee',
      ownerId: 'e-1',
    });
    expect(ownerFiltered).toHaveLength(1);
    expect(ownerFiltered[0]!.memory_id).toBe('mem-e1');
  });

  it('search sorts by importance DESC and respects limit', async () => {
    await repo.create(makeEntry({ memory_id: 'mem-low', content: 'common fact', importance: 0.3 }));
    await repo.create(
      makeEntry({ memory_id: 'mem-high', content: 'common insight', importance: 0.9 }),
    );
    await repo.create(makeEntry({ memory_id: 'mem-mid', content: 'common note', importance: 0.6 }));

    const results = await repo.search('common', { companyId: COMPANY_ID, limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0]!.memory_id).toBe('mem-high');
    expect(results[1]!.memory_id).toBe('mem-mid');
  });

  it('findByOwner returns entries sorted by importance', async () => {
    await repo.create(makeEntry({ memory_id: 'mem-a', owner_id: 'e-dev-1', importance: 0.3 }));
    await repo.create(makeEntry({ memory_id: 'mem-b', owner_id: 'e-dev-1', importance: 0.9 }));
    await repo.create(makeEntry({ memory_id: 'mem-c', owner_id: 'e-other', importance: 1.0 }));

    const results = await repo.findByOwner('e-dev-1');
    expect(results).toHaveLength(2);
    expect(results[0]!.memory_id).toBe('mem-b');
  });

  it('findByOwner filters by category', async () => {
    await repo.create(
      makeEntry({ memory_id: 'mem-exp', owner_id: 'e-dev-1', category: 'experience' }),
    );
    await repo.create(
      makeEntry({ memory_id: 'mem-dec', owner_id: 'e-dev-1', category: 'decision' }),
    );

    const results = await repo.findByOwner('e-dev-1', { category: 'decision' });
    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe('decision');
  });

  it('touchAccess increments access_count and updates accessed_at', async () => {
    await repo.create(makeEntry({ memory_id: 'mem-touch' }));
    const before = await repo.findById('mem-touch');
    expect(before!.access_count).toBe(0);

    await repo.touchAccess('mem-touch');
    const after = await repo.findById('mem-touch');
    expect(after!.access_count).toBe(1);
    expect(after!.accessed_at >= before!.accessed_at).toBe(true);
  });

  it('touchAccess is a no-op for non-existent memory', async () => {
    // Should not throw
    await repo.touchAccess('non-existent');
  });

  it('create sets default null for optional fields', async () => {
    const entry = makeEntry({ memory_id: 'mem-defaults' });
    // Don't set source_thread_id / source_task_run_id
    const created = await repo.create(entry);
    expect(created.source_thread_id).toBeNull();
    expect(created.source_task_run_id).toBeNull();
  });
});
