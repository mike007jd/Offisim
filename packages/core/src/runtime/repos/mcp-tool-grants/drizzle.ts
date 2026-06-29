import * as schema from '@offisim/db-local/dist/schema.js';
import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  McpToolGrantRepository,
  McpToolGrantRow,
  NewMcpToolGrant,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface McpToolGrantsDrizzleRepos {
  mcpToolGrants: McpToolGrantRepository;
}

export function createMcpToolGrantsDrizzleRepos(db: Db): McpToolGrantsDrizzleRepos {
  const mcpToolGrants: McpToolGrantRepository = {
    async create(grant: NewMcpToolGrant) {
      const row: McpToolGrantRow = {
        ...grant,
        risk_class: grant.risk_class ?? 'write',
        risk_source: grant.risk_source ?? 'human_override',
        trusted_server_id: grant.trusted_server_id ?? null,
        created_at: grant.created_at ?? now(),
      };
      db.insert(schema.mcpToolGrants).values(row).run();
      return row;
    },
    async listByEmployee(companyId, employeeId) {
      return db
        .select()
        .from(schema.mcpToolGrants)
        .where(
          and(
            eq(schema.mcpToolGrants.company_id, companyId),
            eq(schema.mcpToolGrants.employee_id, employeeId),
          ),
        )
        .orderBy(asc(schema.mcpToolGrants.created_at))
        .all() as McpToolGrantRow[];
    },
    async delete(companyId, employeeId, serverName, toolName) {
      db.delete(schema.mcpToolGrants)
        .where(
          and(
            eq(schema.mcpToolGrants.company_id, companyId),
            eq(schema.mcpToolGrants.employee_id, employeeId),
            eq(schema.mcpToolGrants.server_name, serverName),
            eq(schema.mcpToolGrants.tool_name, toolName),
          ),
        )
        .run();
    },
    async hasGrant(companyId, employeeId, serverName, toolName) {
      const rows = db
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
        .limit(1)
        .all();
      return rows.length > 0;
    },
  };

  return { mcpToolGrants };
}
