import type {
  McpAuditRepository,
  McpAuditRow,
  NewMcpAudit,
  NewRack,
  NewSlot,
  NewToolPermissionApproval,
  NewWorkstationRack,
  RackRepository,
  RackRow,
  RackStatus,
  SlotRepository,
  SlotRow,
  SlotStatus,
  ToolPermissionApprovalLookup,
  ToolPermissionApprovalRepository,
  ToolPermissionApprovalRow,
  WorkstationRackRepository,
  WorkstationRackRow,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows } from '../memory-utils.js';

export class MemoryRackRepository implements RackRepository {
  private readonly store = new Map<string, RackRow>();

  constructor(initialRows?: Iterable<RackRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.rack_id, { ...row });
    }
  }

  async create(rack: NewRack): Promise<RackRow> {
    const row: RackRow = {
      ...rack,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.rack_id, row);
    return row;
  }
  async findById(rackId: string): Promise<RackRow | null> {
    return this.store.get(rackId) ?? null;
  }
  async findByCompany(companyId: string): Promise<RackRow[]> {
    return [...this.store.values()].filter((r) => r.company_id === companyId);
  }
  async updateStatus(rackId: string, status: RackStatus): Promise<void> {
    const row = this.store.get(rackId);
    if (row) this.store.set(rackId, { ...row, status, updated_at: new Date().toISOString() });
  }
  async delete(rackId: string): Promise<void> {
    this.store.delete(rackId);
  }

  snapshot(): RackRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemorySlotRepository implements SlotRepository {
  private readonly store = new Map<string, SlotRow>();

  constructor(initialRows?: Iterable<SlotRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.slot_id, { ...row });
    }
  }

  async create(slot: NewSlot): Promise<SlotRow> {
    const row: SlotRow = {
      ...slot,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.slot_id, row);
    return row;
  }
  async findByRack(rackId: string): Promise<SlotRow[]> {
    return [...this.store.values()].filter((s) => s.rack_id === rackId);
  }
  async updateStatus(slotId: string, status: SlotStatus): Promise<void> {
    const row = this.store.get(slotId);
    if (row) this.store.set(slotId, { ...row, status, updated_at: new Date().toISOString() });
  }
  async delete(slotId: string): Promise<void> {
    this.store.delete(slotId);
  }

  snapshot(): SlotRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryWorkstationRackRepository implements WorkstationRackRepository {
  private readonly store: WorkstationRackRow[] = [];

  constructor(initialRows?: Iterable<WorkstationRackRow>) {
    if (!initialRows) return;
    this.store.push(...cloneRows(initialRows));
  }

  async create(binding: NewWorkstationRack): Promise<WorkstationRackRow> {
    const row: WorkstationRackRow = { ...binding, created_at: new Date().toISOString() };
    this.store.push(row);
    return row;
  }
  async findByWorkstation(workstationId: string): Promise<WorkstationRackRow[]> {
    return this.store.filter((r) => r.workstation_id === workstationId);
  }
  async findByRack(rackId: string): Promise<WorkstationRackRow[]> {
    return this.store.filter((r) => r.rack_id === rackId);
  }
  async delete(workstationId: string, rackId: string): Promise<void> {
    const idx = this.store.findIndex(
      (r) => r.workstation_id === workstationId && r.rack_id === rackId,
    );
    if (idx >= 0) this.store.splice(idx, 1);
  }

  snapshot(): WorkstationRackRow[] {
    return cloneRows(this.store);
  }
}

export class MemoryMcpAuditRepository implements McpAuditRepository {
  private readonly rows: McpAuditRow[] = [];

  constructor(initialRows?: Iterable<McpAuditRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(audit: NewMcpAudit): Promise<McpAuditRow> {
    this.rows.push(audit);
    return audit;
  }

  async listByThread(threadId: string): Promise<McpAuditRow[]> {
    return this.rows.filter((r) => r.thread_id === threadId);
  }

  async hasSuccessfulToolCall(
    threadId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<boolean> {
    return this.rows.some(
      (row) =>
        row.thread_id === threadId &&
        row.employee_id === employeeId &&
        row.server_name === serverName &&
        row.tool_name === toolName &&
        row.error === null,
    );
  }

  snapshot(): McpAuditRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryToolPermissionApprovalRepository implements ToolPermissionApprovalRepository {
  private readonly rows = new Map<string, ToolPermissionApprovalRow>();

  constructor(initialRows?: Iterable<ToolPermissionApprovalRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.rows.set(row.approval_id, { ...row });
    }
  }

  async create(approval: NewToolPermissionApproval): Promise<ToolPermissionApprovalRow> {
    const row = { ...approval };
    this.rows.set(row.approval_id, row);
    return row;
  }

  async findReusableApproval(
    lookup: ToolPermissionApprovalLookup,
  ): Promise<ToolPermissionApprovalRow | null> {
    const now = new Date().toISOString();
    const candidates = [...this.rows.values()]
      .filter((row) => matchesApprovalLookup(row, lookup, now))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return candidates[0] ?? null;
  }

  async hasApproval(lookup: ToolPermissionApprovalLookup): Promise<boolean> {
    const now = new Date().toISOString();
    return [...this.rows.values()].some((row) => matchesApprovalLookup(row, lookup, now));
  }

  async consumeApproval(approvalId: string, consumedAt: string): Promise<void> {
    const row = this.rows.get(approvalId);
    if (!row || row.scope !== 'once' || row.consumed_at) return;
    this.rows.set(approvalId, { ...row, consumed_at: consumedAt });
  }

  snapshot(): ToolPermissionApprovalRow[] {
    return cloneRows(this.rows.values());
  }
}

function matchesApprovalLookup(
  row: ToolPermissionApprovalRow,
  lookup: ToolPermissionApprovalLookup,
  now: string,
  requireReusable = true,
): boolean {
  return (
    row.thread_id === lookup.threadId &&
    row.company_id === lookup.companyId &&
    row.server_name === lookup.serverName &&
    row.tool_name === lookup.toolName &&
    (row.employee_id ?? null) === (lookup.employeeId ?? null) &&
    (!lookup.policyHash || row.policy_hash === lookup.policyHash) &&
    (!requireReusable || row.scope === 'thread' || row.consumed_at === null) &&
    (!row.expires_at || row.expires_at > now)
  );
}

export interface PermissionsMemoryRepos {
  racks: MemoryRackRepository;
  slots: MemorySlotRepository;
  workstationRacks: MemoryWorkstationRackRepository;
  mcpAudit: MemoryMcpAuditRepository;
  toolPermissionApprovals: MemoryToolPermissionApprovalRepository;
}

export function createPermissionsMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): PermissionsMemoryRepos {
  const racks = new MemoryRackRepository(snapshot?.racks);
  const slots = new MemorySlotRepository(snapshot?.slots);
  const workstationRacks = new MemoryWorkstationRackRepository(snapshot?.workstationRacks);
  const mcpAudit = new MemoryMcpAuditRepository(snapshot?.mcpAudit);
  const toolPermissionApprovals = new MemoryToolPermissionApprovalRepository(
    snapshot?.toolPermissionApprovals,
  );
  return { racks, slots, workstationRacks, mcpAudit, toolPermissionApprovals };
}
