import type {
  McpAuditRow,
  NewMcpAudit,
  NewRack,
  NewSlot,
  RackRow,
  RuntimeRepositories,
  SlotRow,
  WorkstationRackRow,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, eq, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface PermissionsTauriRepos {
  racks: RuntimeRepositories['racks'];
  slots: RuntimeRepositories['slots'];
  workstationRacks: RuntimeRepositories['workstationRacks'];
  mcpAudit: RuntimeRepositories['mcpAudit'];
}

export function createPermissionsTauriRepos(db: TauriDrizzleDb): PermissionsTauriRepos {
  const racks: RuntimeRepositories['racks'] = {
    async create(rack: NewRack) {
      const ts = now();
      const row: RackRow = { ...rack, created_at: ts, updated_at: ts };
      await db.insert(schema.racks).values(row);
      return row;
    },
    async findById(rackId) {
      const rows = await db.select().from(schema.racks).where(eq(schema.racks.rack_id, rackId));
      return (rows[0] as RackRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.racks)
        .where(eq(schema.racks.company_id, companyId))) as RackRow[];
    },
    async updateStatus(rackId, status) {
      await db
        .update(schema.racks)
        .set({ status, updated_at: now() })
        .where(eq(schema.racks.rack_id, rackId));
    },
    async delete(rackId) {
      await db.delete(schema.racks).where(eq(schema.racks.rack_id, rackId));
    },
  };

  const slots: RuntimeRepositories['slots'] = {
    async create(slot: NewSlot) {
      const ts = now();
      const row: SlotRow = { ...slot, created_at: ts, updated_at: ts };
      await db.insert(schema.slots).values(row);
      return row;
    },
    async findByRack(rackId) {
      return (await db
        .select()
        .from(schema.slots)
        .where(eq(schema.slots.rack_id, rackId))) as SlotRow[];
    },
    async updateStatus(slotId, status) {
      await db
        .update(schema.slots)
        .set({ status, updated_at: now() })
        .where(eq(schema.slots.slot_id, slotId));
    },
    async delete(slotId) {
      await db.delete(schema.slots).where(eq(schema.slots.slot_id, slotId));
    },
  };

  const workstationRacks: RuntimeRepositories['workstationRacks'] = {
    async create(binding) {
      const row = { ...binding, created_at: new Date().toISOString() };
      await db.insert(schema.workstationRacks).values(row);
      return row;
    },
    async findByWorkstation(workstationId) {
      return (await db
        .select()
        .from(schema.workstationRacks)
        .where(eq(schema.workstationRacks.workstation_id, workstationId))) as WorkstationRackRow[];
    },
    async findByRack(rackId) {
      return (await db
        .select()
        .from(schema.workstationRacks)
        .where(eq(schema.workstationRacks.rack_id, rackId))) as WorkstationRackRow[];
    },
    async delete(workstationId, rackId) {
      await db
        .delete(schema.workstationRacks)
        .where(
          and(
            eq(schema.workstationRacks.workstation_id, workstationId),
            eq(schema.workstationRacks.rack_id, rackId),
          ),
        );
    },
  };

  const mcpAudit: RuntimeRepositories['mcpAudit'] = {
    async create(audit: NewMcpAudit) {
      await db.insert(schema.mcpAuditLog).values(audit);
      return audit as McpAuditRow;
    },
    async listByThread(threadId) {
      return (await db
        .select()
        .from(schema.mcpAuditLog)
        .where(eq(schema.mcpAuditLog.thread_id, threadId))) as McpAuditRow[];
    },
    async hasSuccessfulToolCall(threadId, employeeId, serverName, toolName) {
      const rows = await db
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
        .limit(1);
      return rows.length > 0;
    },
  };

  return { racks, slots, workstationRacks, mcpAudit };
}
