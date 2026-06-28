import type {
  McpToolGrantRepository,
  McpToolGrantRow,
  NewMcpToolGrant,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, asc, eq } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface McpToolGrantsTauriRepos {
  mcpToolGrants: McpToolGrantRepository;
}

export function createMcpToolGrantsTauriRepos(db: TauriDrizzleDb): McpToolGrantsTauriRepos {
  const mcpToolGrants: McpToolGrantRepository = {
    async create(grant: NewMcpToolGrant) {
      const row: McpToolGrantRow = {
        ...grant,
        created_at: grant.created_at ?? now(),
      };
      await db.insert(schema.mcpToolGrants).values(row);
      return row;
    },
    async listByEmployee(companyId, employeeId) {
      return (await db
        .select()
        .from(schema.mcpToolGrants)
        .where(
          and(
            eq(schema.mcpToolGrants.company_id, companyId),
            eq(schema.mcpToolGrants.employee_id, employeeId),
          ),
        )
        .orderBy(asc(schema.mcpToolGrants.created_at))) as McpToolGrantRow[];
    },
    async delete(companyId, employeeId, serverName, toolName) {
      await db
        .delete(schema.mcpToolGrants)
        .where(
          and(
            eq(schema.mcpToolGrants.company_id, companyId),
            eq(schema.mcpToolGrants.employee_id, employeeId),
            eq(schema.mcpToolGrants.server_name, serverName),
            eq(schema.mcpToolGrants.tool_name, toolName),
          ),
        );
    },
    async hasGrant(companyId, employeeId, serverName, toolName) {
      const rows = await db
        .select({ grant_id: schema.mcpToolGrants.grant_id })
        .from(schema.mcpToolGrants)
        .where(
          and(
            eq(schema.mcpToolGrants.company_id, companyId),
            eq(schema.mcpToolGrants.employee_id, employeeId),
            eq(schema.mcpToolGrants.server_name, serverName),
            eq(schema.mcpToolGrants.tool_name, toolName),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };

  return { mcpToolGrants };
}
