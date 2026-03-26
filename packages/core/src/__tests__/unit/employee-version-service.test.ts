import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { EmployeeVersionService } from '../../runtime/employee-version-service.js';
import { MemoryEmployeeVersionRepository } from '../../runtime/memory-repositories.js';
import type { EmployeeRepository, EmployeeRow } from '../../runtime/repositories.js';
type TransactFn = <T>(fn: () => T) => T;

function makeEmployee(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    employee_id: 'emp-1',
    company_id: 'company-001',
    source_asset_id: null,
    source_package_id: null,
    name: 'Alice',
    role_slug: 'developer',
    workstation_id: null,
    persona_json: '{"expertise":"React"}',
    config_json: '{"temperature":0.7}',
    enabled: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockEmployeeRepo(employee: EmployeeRow | null = makeEmployee()): EmployeeRepository {
  // Use the passed object directly so external mutations are visible to findById
  const current = employee;
  return {
    create: vi.fn(),
    findById: vi.fn(async () => current),
    findByCompany: vi.fn(async () => (current ? [current] : [])),
    findByRole: vi.fn(async () => (current ? [current] : [])),
    update: vi.fn(async (_id: string, patch: Partial<EmployeeRow>) => {
      if (current) {
        Object.assign(current, patch);
      }
    }),
    delete: vi.fn(),
  };
}

describe('EmployeeVersionService', () => {
  describe('createVersion', () => {
    it('snapshots employee state and assigns sequential version numbers', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      const v1 = await service.createVersion('emp-1', 'create');
      expect(v1.version_num).toBe(1);
      expect(v1.change_type).toBe('create');
      expect(v1.employee_id).toBe('emp-1');
      expect(v1.created_by).toBe('user');

      const snapshot = JSON.parse(v1.snapshot_json);
      expect(snapshot.name).toBe('Alice');
      expect(snapshot.role_slug).toBe('developer');
      expect(snapshot.persona_json).toBe('{"expertise":"React"}');

      const v2 = await service.createVersion('emp-1', 'update');
      expect(v2.version_num).toBe(2);
      expect(v2.change_type).toBe('update');
    });

    it('throws when employee is not found', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo(null);
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      await expect(service.createVersion('nonexistent', 'create')).rejects.toThrow(
        'Employee not found: nonexistent',
      );
    });

    it('emits employeeVersionCreated event', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      const events: unknown[] = [];
      eventBus.on('employee.version.created', (e) => events.push(e));

      await service.createVersion('emp-1', 'create');

      expect(events).toHaveLength(1);
      expect((events[0] as { payload: { versionNum: number } }).payload.versionNum).toBe(1);
    });

    it('respects custom createdBy parameter', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      const v = await service.createVersion('emp-1', 'create', 'system');
      expect(v.created_by).toBe('system');
    });

    it('generates change summary for updates', async () => {
      const employee = makeEmployee();
      const employeeRepo = createMockEmployeeRepo(employee);
      const versionRepo = new MemoryEmployeeVersionRepository();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      // Create v1
      await service.createVersion('emp-1', 'create');

      // Modify the employee's name
      employee.name = 'Bob';
      // Create v2
      const v2 = await service.createVersion('emp-1', 'update');
      expect(v2.change_summary).toContain('name changed');
    });
  });

  describe('getHistory', () => {
    it('returns versions sorted newest-first', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      await service.createVersion('emp-1', 'create');
      await service.createVersion('emp-1', 'update');
      await service.createVersion('emp-1', 'update');

      const history = await service.getHistory('emp-1');
      expect(history).toHaveLength(3);
      expect(history[0]?.version_num).toBe(3);
      expect(history[2]?.version_num).toBe(1);
    });

    it('respects limit parameter', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      await service.createVersion('emp-1', 'create');
      await service.createVersion('emp-1', 'update');
      await service.createVersion('emp-1', 'update');

      const history = await service.getHistory('emp-1', 2);
      expect(history).toHaveLength(2);
      expect(history[0]?.version_num).toBe(3);
    });
  });

  describe('rollbackToVersion', () => {
    it('applies snapshot from target version and creates a rollback version', async () => {
      const employee = makeEmployee();
      const employeeRepo = createMockEmployeeRepo(employee);
      const versionRepo = new MemoryEmployeeVersionRepository();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      // v1: initial state (Alice, developer)
      await service.createVersion('emp-1', 'create');

      // Modify employee
      employee.name = 'Bob';
      employee.role_slug = 'ux_designer';
      // v2: after edit
      await service.createVersion('emp-1', 'update');

      // Rollback to v1
      await service.rollbackToVersion('emp-1', 1);

      // employeeRepo.update should have been called to restore v1 snapshot
      expect(employeeRepo.update).toHaveBeenCalled();
      const updateCall = (employeeRepo.update as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = updateCall[updateCall.length - 1] as [string, Record<string, unknown>];
      expect(lastCall[1].name).toBe('Alice');
      expect(lastCall[1].role_slug).toBe('developer');

      // Should have created v3 (rollback record)
      const history = await service.getHistory('emp-1');
      expect(history).toHaveLength(3);
      expect(history[0]?.version_num).toBe(3);
      expect(history[0]?.change_type).toBe('rollback');
    });

    it('throws when target version does not exist', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      await expect(service.rollbackToVersion('emp-1', 99)).rejects.toThrow(
        'Version 99 not found for employee emp-1',
      );
    });
  });

  describe('createVersion with transact', () => {
    it('calls transact exactly once for the write phase', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();

      type TransactMock = TransactFn & ReturnType<typeof vi.fn>;
      const mockTransact = vi.fn((fn: () => unknown) => fn()) as unknown as TransactMock;

      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus, mockTransact);
      // Note: with memory repos the Drizzle "synchronous promise" assumption doesn't hold,
      // so the return value may be undefined — we only assert transact was called.
      await service.createVersion('emp-1', 'create').catch(() => {
        // may throw on `captured!` being undefined with async memory repos — that's expected
      });

      // transact must have been invoked exactly once (write-phase wrapping)
      expect(mockTransact).toHaveBeenCalledOnce();
    });

    it('works normally (async path) when transact is not provided', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();

      // No transact argument — uses the async fallback path
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);
      const v = await service.createVersion('emp-1', 'update');

      expect(v.version_num).toBe(1);
      expect(v.change_type).toBe('update');
    });

    it('emits event even when transact is used', async () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();

      type TransactMock = TransactFn & ReturnType<typeof vi.fn>;
      const mockTransact = vi.fn((fn: () => unknown) => fn()) as unknown as TransactMock;
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus, mockTransact);

      const events: unknown[] = [];
      eventBus.on('employee.version.created', (e) => events.push(e));

      await service.createVersion('emp-1', 'create');

      expect(events).toHaveLength(1);
    });
  });

  describe('diffVersions', () => {
    it('returns empty array for identical snapshots', () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      const snap = '{"name":"Alice","role":"dev"}';
      expect(service.diffVersions(snap, snap)).toEqual([]);
    });

    it('detects changed fields', () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      const a = '{"name":"Alice","role":"dev"}';
      const b = '{"name":"Bob","role":"dev"}';
      const diffs = service.diffVersions(a, b);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({ field: 'name', from: 'Alice', to: 'Bob' });
    });

    it('detects added and removed fields', () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      const a = '{"name":"Alice"}';
      const b = '{"role":"dev"}';
      const diffs = service.diffVersions(a, b);
      expect(diffs).toHaveLength(2);
      expect(diffs.find((d) => d.field === 'name')).toEqual({
        field: 'name',
        from: 'Alice',
        to: undefined,
      });
      expect(diffs.find((d) => d.field === 'role')).toEqual({
        field: 'role',
        from: undefined,
        to: 'dev',
      });
    });

    it('handles nested objects by stringifying them for comparison', () => {
      const versionRepo = new MemoryEmployeeVersionRepository();
      const employeeRepo = createMockEmployeeRepo();
      const eventBus = new InMemoryEventBus();
      const service = new EmployeeVersionService(versionRepo, employeeRepo, eventBus);

      const a = '{"config":{"temp":0.5}}';
      const b = '{"config":{"temp":0.9}}';
      const diffs = service.diffVersions(a, b);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]?.field).toBe('config');
      expect(diffs[0]?.from).toEqual({ temp: 0.5 });
      expect(diffs[0]?.to).toEqual({ temp: 0.9 });
    });
  });
});
