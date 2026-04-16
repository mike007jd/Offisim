import * as schema from '@offisim/db-local/dist/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  McpAuditRepository,
  McpAuditRow,
  NewMcpAudit,
  NewRack,
  NewSlot,
  RackRow,
  RuntimeRepositories,
  SlotRow,
  WorkstationRackRow,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface PermissionsDrizzleRepos {
  racks: RuntimeRepositories['racks'];
  slots: RuntimeRepositories['slots'];
  workstationRacks: RuntimeRepositories['workstationRacks'];
  mcpAudit: McpAuditRepository;
}

export function createPermissionsDrizzleRepos(db: Db): PermissionsDrizzleRepos {
  const racks: RuntimeRepositories['racks'] = {
    async create(rack: NewRack) {
      const ts = now();
      const row: RackRow = { ...rack, created_at: ts, updated_at: ts };
      db.insert(schema.racks).values(row).run();
      return row;
    },
    async findById(rackId) {
      const rows = db.select().from(schema.racks).where(eq(schema.racks.rack_id, rackId)).all();
      return (rows[0] as RackRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.racks)
        .where(eq(schema.racks.company_id, companyId))
        .all() as RackRow[];
    },
    async updateStatus(rackId, status) {
      db.update(schema.racks)
        .set({ status, updated_at: now() })
        .where(eq(schema.racks.rack_id, rackId))
        .run();
    },
    async delete(rackId) {
      db.delete(schema.racks).where(eq(schema.racks.rack_id, rackId)).run();
    },
  };

  const slots: RuntimeRepositories['slots'] = {
    async create(slot: NewSlot) {
      const ts = now();
      const row: SlotRow = { ...slot, created_at: ts, updated_at: ts };
      db.insert(schema.slots).values(row).run();
      return row;
    },
    async findByRack(rackId) {
      return db
        .select()
        .from(schema.slots)
        .where(eq(schema.slots.rack_id, rackId))
        .all() as SlotRow[];
    },
    async updateStatus(slotId, status) {
      db.update(schema.slots)
        .set({ status, updated_at: now() })
        .where(eq(schema.slots.slot_id, slotId))
        .run();
    },
    async delete(slotId) {
      db.delete(schema.slots).where(eq(schema.slots.slot_id, slotId)).run();
    },
  };

  const workstationRacks: RuntimeRepositories['workstationRacks'] = {
    async create(binding) {
      const row = { ...binding, created_at: now() };
      db.insert(schema.workstationRacks).values(row).run();
      return row;
    },
    async findByWorkstation(workstationId) {
      return db
        .select()
        .from(schema.workstationRacks)
        .where(eq(schema.workstationRacks.workstation_id, workstationId))
        .all() as WorkstationRackRow[];
    },
    async findByRack(rackId) {
      return db
        .select()
        .from(schema.workstationRacks)
        .where(eq(schema.workstationRacks.rack_id, rackId))
        .all() as WorkstationRackRow[];
    },
    async delete(workstationId, rackId) {
      db.delete(schema.workstationRacks)
        .where(
          and(
            eq(schema.workstationRacks.workstation_id, workstationId),
            eq(schema.workstationRacks.rack_id, rackId),
          ),
        )
        .run();
    },
  };

  const mcpAudit: McpAuditRepository = {
    async create(audit: NewMcpAudit) {
      db.insert(schema.mcpAuditLog).values(audit).run();
      return audit as McpAuditRow;
    },
    async listByThread(threadId) {
      return db
        .select()
        .from(schema.mcpAuditLog)
        .where(eq(schema.mcpAuditLog.thread_id, threadId))
        .all() as McpAuditRow[];
    },
    async hasSuccessfulToolCall(threadId, employeeId, serverName, toolName) {
      const rows = db
        .select({ audit_id: schema.mcpAuditLog.audit_id })
        .from(schema.mcpAuditLog)
        .where(
          and(
            eq(schema.mcpAuditLog.thread_id, threadId),
            eq(schema.mcpAuditLog.employee_id, employeeId),
            eq(schema.mcpAuditLog.server_name, serverName),
            eq(schema.mcpAuditLog.tool_name, toolName),
            sql`${schema.mcpAuditLog.error} IS NULL`,
          ),
        )
        .limit(1)
        .all();
      return rows.length > 0;
    },
  };

  return { racks, slots, workstationRacks, mcpAudit };
}
