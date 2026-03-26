import { describe, expect, it } from 'vitest';
import { MemoryEmployeeVersionRepository } from '../../runtime/memory-repositories.js';

describe('MemoryEmployeeVersionRepository', () => {
  function createRepo() {
    return new MemoryEmployeeVersionRepository();
  }

  it('creates a version and returns it with generated id and timestamp', async () => {
    const repo = createRepo();
    const row = await repo.create({
      employee_id: 'e-1',
      version_num: 1,
      change_type: 'create',
      snapshot_json: '{"name":"Alice"}',
      change_summary: 'Initial creation',
      created_by: 'user',
    });
    expect(row.version_id).toBeDefined();
    expect(row.employee_id).toBe('e-1');
    expect(row.version_num).toBe(1);
    expect(row.change_type).toBe('create');
    expect(row.snapshot_json).toBe('{"name":"Alice"}');
    expect(row.change_summary).toBe('Initial creation');
    expect(row.created_by).toBe('user');
    expect(row.created_at).toBeDefined();
  });

  it('findByEmployee returns versions sorted by version_num descending', async () => {
    const repo = createRepo();
    await repo.create({
      employee_id: 'e-1',
      version_num: 1,
      change_type: 'create',
      snapshot_json: '{"v":1}',
      change_summary: null,
      created_by: 'user',
    });
    await repo.create({
      employee_id: 'e-1',
      version_num: 2,
      change_type: 'update',
      snapshot_json: '{"v":2}',
      change_summary: null,
      created_by: 'user',
    });
    await repo.create({
      employee_id: 'e-2',
      version_num: 1,
      change_type: 'create',
      snapshot_json: '{"v":1}',
      change_summary: null,
      created_by: 'user',
    });

    const results = await repo.findByEmployee('e-1');
    expect(results).toHaveLength(2);
    expect(results[0]?.version_num).toBe(2);
    expect(results[1]?.version_num).toBe(1);
  });

  it('findByEmployee respects limit', async () => {
    const repo = createRepo();
    for (let i = 1; i <= 5; i++) {
      await repo.create({
        employee_id: 'e-1',
        version_num: i,
        change_type: 'update',
        snapshot_json: `{"v":${i}}`,
        change_summary: null,
        created_by: 'user',
      });
    }
    const results = await repo.findByEmployee('e-1', { limit: 3 });
    expect(results).toHaveLength(3);
    expect(results[0]?.version_num).toBe(5);
  });

  it('findByVersion returns the matching version or null', async () => {
    const repo = createRepo();
    await repo.create({
      employee_id: 'e-1',
      version_num: 1,
      change_type: 'create',
      snapshot_json: '{"v":1}',
      change_summary: null,
      created_by: 'user',
    });

    const found = await repo.findByVersion('e-1', 1);
    expect(found).not.toBeNull();
    expect(found?.version_num).toBe(1);

    const notFound = await repo.findByVersion('e-1', 99);
    expect(notFound).toBeNull();
  });

  it('getLatestVersionNum returns 0 for no versions, max for existing', async () => {
    const repo = createRepo();
    expect(await repo.getLatestVersionNum('e-1')).toBe(0);

    await repo.create({
      employee_id: 'e-1',
      version_num: 1,
      change_type: 'create',
      snapshot_json: '{}',
      change_summary: null,
      created_by: 'user',
    });
    await repo.create({
      employee_id: 'e-1',
      version_num: 3,
      change_type: 'update',
      snapshot_json: '{}',
      change_summary: null,
      created_by: 'user',
    });

    expect(await repo.getLatestVersionNum('e-1')).toBe(3);
  });
});
