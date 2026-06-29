import type {
  McpAuditRow,
  NewMcpAudit,
  NewRack,
  NewSlot,
  NewToolPermissionApproval,
  RackRow,
  RuntimeRepositories,
  SlotRow,
  ToolPermissionApprovalRow,
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
  toolPermissionApprovals: RuntimeRepositories['toolPermissionApprovals'];
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
      const row: McpAuditRow = {
        ...audit,
        approval_status: audit.approval_status ?? 'not_required',
        approved_by: audit.approved_by ?? null,
      };
      await db.insert(schema.mcpAuditLog).values(row);
      return row;
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
            sql`${schema.mcpAuditLog.approval_status} != 'human_denied'`,
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };

  const toolPermissionApprovals: RuntimeRepositories['toolPermissionApprovals'] = {
    async create(approval: NewToolPermissionApproval) {
      await db.insert(schema.toolPermissionApprovals).values(approval);
      return approval as ToolPermissionApprovalRow;
    },
    async hasApproval(lookup) {
      const rows = await db
        .select({ approval_id: schema.toolPermissionApprovals.approval_id })
        .from(schema.toolPermissionApprovals)
        .where(
          and(
            eq(schema.toolPermissionApprovals.thread_id, lookup.threadId),
            eq(schema.toolPermissionApprovals.company_id, lookup.companyId),
            approvalEmployeeCondition(lookup.employeeId),
            eq(schema.toolPermissionApprovals.server_name, lookup.serverName),
            eq(schema.toolPermissionApprovals.tool_name, lookup.toolName),
            lookup.policyHash
              ? eq(schema.toolPermissionApprovals.policy_hash, lookup.policyHash)
              : sql`1 = 1`,
            sql`(${schema.toolPermissionApprovals.scope} = 'thread' OR ${schema.toolPermissionApprovals.consumed_at} IS NULL)`,
            sql`(${schema.toolPermissionApprovals.expires_at} IS NULL OR ${schema.toolPermissionApprovals.expires_at} > datetime('now'))`,
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async findReusableApproval(lookup) {
      const rows = await db
        .select()
        .from(schema.toolPermissionApprovals)
        .where(
          and(
            eq(schema.toolPermissionApprovals.thread_id, lookup.threadId),
            eq(schema.toolPermissionApprovals.company_id, lookup.companyId),
            approvalEmployeeCondition(lookup.employeeId),
            eq(schema.toolPermissionApprovals.server_name, lookup.serverName),
            eq(schema.toolPermissionApprovals.tool_name, lookup.toolName),
            lookup.policyHash
              ? eq(schema.toolPermissionApprovals.policy_hash, lookup.policyHash)
              : sql`1 = 1`,
            sql`(${schema.toolPermissionApprovals.scope} = 'thread' OR ${schema.toolPermissionApprovals.consumed_at} IS NULL)`,
            sql`(${schema.toolPermissionApprovals.expires_at} IS NULL OR ${schema.toolPermissionApprovals.expires_at} > datetime('now'))`,
          ),
        )
        .orderBy(sql`${schema.toolPermissionApprovals.created_at} DESC`)
        .limit(1);
      return (rows[0] as ToolPermissionApprovalRow | undefined) ?? null;
    },
    async consumeApproval(approvalId, consumedAt) {
      await db
        .update(schema.toolPermissionApprovals)
        .set({ consumed_at: consumedAt })
        .where(
          and(
            eq(schema.toolPermissionApprovals.approval_id, approvalId),
            eq(schema.toolPermissionApprovals.scope, 'once'),
            sql`${schema.toolPermissionApprovals.consumed_at} IS NULL`,
          ),
        );
    },
  };

  return { racks, slots, workstationRacks, mcpAudit, toolPermissionApprovals };
}

function approvalEmployeeCondition(employeeId: string | null | undefined) {
  return employeeId == null
    ? sql`${schema.toolPermissionApprovals.employee_id} IS NULL`
    : eq(schema.toolPermissionApprovals.employee_id, employeeId);
}
