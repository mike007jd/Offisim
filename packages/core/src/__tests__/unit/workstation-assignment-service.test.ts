import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../../events/event-bus.js';
import type { EmployeeRepository, EmployeeRow } from '../../runtime/repositories.js';
import { WorkstationAssignmentService } from '../../runtime/workstation-assignment-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmployeeRow(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    employee_id: 'emp-alice',
    company_id: 'company-1',
    source_asset_id: null,
    source_package_id: null,
    name: 'Alice',
    role_slug: 'developer',
    workstation_id: null,
    persona_json: null,
    config_json: null,
    enabled: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createMockEmployeeRepo(): EmployeeRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByCompany: vi.fn(),
    findByRole: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
    once: vi.fn(() => () => {}),
    removeAll: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkstationAssignmentService', () => {
  let employees: ReturnType<typeof createMockEmployeeRepo>;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let service: WorkstationAssignmentService;

  beforeEach(() => {
    employees = createMockEmployeeRepo();
    eventBus = createMockEventBus();
    service = new WorkstationAssignmentService(employees, eventBus);
  });

  it('should assign an employee to a workstation', async () => {
    const row = makeEmployeeRow({ workstation_id: null });
    vi.mocked(employees.findById).mockResolvedValue(row);

    await service.assignToWorkstation('emp-alice', 'ws-1');

    expect(employees.update).toHaveBeenCalledWith('emp-alice', { workstation_id: 'ws-1' });
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'employee.workstation.changed',
        entityId: 'emp-alice',
        payload: expect.objectContaining({
          employeeId: 'emp-alice',
          fromWorkstationId: null,
          toWorkstationId: 'ws-1',
        }),
      }),
    );
  });

  it('should unassign an employee (set workstation to null)', async () => {
    const row = makeEmployeeRow({ workstation_id: 'ws-2' });
    vi.mocked(employees.findById).mockResolvedValue(row);

    await service.assignToWorkstation('emp-alice', null);

    expect(employees.update).toHaveBeenCalledWith('emp-alice', { workstation_id: null });
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'employee.workstation.changed',
        payload: expect.objectContaining({
          fromWorkstationId: 'ws-2',
          toWorkstationId: null,
        }),
      }),
    );
  });

  it('should reassign from one workstation to another', async () => {
    const row = makeEmployeeRow({ workstation_id: 'ws-1' });
    vi.mocked(employees.findById).mockResolvedValue(row);

    await service.assignToWorkstation('emp-alice', 'ws-3');

    expect(employees.update).toHaveBeenCalledWith('emp-alice', { workstation_id: 'ws-3' });
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'employee.workstation.changed',
        payload: expect.objectContaining({
          fromWorkstationId: 'ws-1',
          toWorkstationId: 'ws-3',
        }),
      }),
    );
  });

  it('should no-op when assigning to the same workstation', async () => {
    const row = makeEmployeeRow({ workstation_id: 'ws-1' });
    vi.mocked(employees.findById).mockResolvedValue(row);

    await service.assignToWorkstation('emp-alice', 'ws-1');

    expect(employees.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('should throw when employee does not exist', async () => {
    vi.mocked(employees.findById).mockResolvedValue(null);

    await expect(service.assignToWorkstation('emp-nonexistent', 'ws-1')).rejects.toThrow(
      'Employee emp-nonexistent not found',
    );

    expect(employees.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('should include correct companyId from employee row in event', async () => {
    const row = makeEmployeeRow({ company_id: 'my-company', workstation_id: null });
    vi.mocked(employees.findById).mockResolvedValue(row);

    await service.assignToWorkstation('emp-alice', 'ws-2');

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'my-company',
      }),
    );
  });
});
