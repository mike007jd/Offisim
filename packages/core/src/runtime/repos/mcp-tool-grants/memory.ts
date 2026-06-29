import type {
  McpToolGrantRepository,
  McpToolGrantRow,
  NewMcpToolGrant,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows } from '../memory-utils.js';

function now(): string {
  return new Date().toISOString();
}

function keyOf(companyId: string, employeeId: string, serverName: string, toolName: string): string {
  return `${companyId}\0${employeeId}\0${serverName}\0${toolName}`;
}

export class MemoryMcpToolGrantRepository implements McpToolGrantRepository {
  private readonly rows = new Map<string, McpToolGrantRow>();

  constructor(initialRows?: Iterable<McpToolGrantRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.rows.set(keyOf(row.company_id, row.employee_id, row.server_name, row.tool_name), {
        ...row,
      });
    }
  }

  async create(grant: NewMcpToolGrant): Promise<McpToolGrantRow> {
    const row: McpToolGrantRow = {
      ...grant,
      risk_class: grant.risk_class ?? 'write',
      risk_source: grant.risk_source ?? 'human_override',
      trusted_server_id: grant.trusted_server_id ?? null,
      created_at: grant.created_at ?? now(),
    };
    this.rows.set(keyOf(row.company_id, row.employee_id, row.server_name, row.tool_name), row);
    return row;
  }

  async listByEmployee(companyId: string, employeeId: string): Promise<McpToolGrantRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.company_id === companyId && row.employee_id === employeeId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async delete(
    companyId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<void> {
    this.rows.delete(keyOf(companyId, employeeId, serverName, toolName));
  }

  async hasGrant(
    companyId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<boolean> {
    return this.rows.has(keyOf(companyId, employeeId, serverName, toolName));
  }

  snapshot(): McpToolGrantRow[] {
    return cloneRows(this.rows.values());
  }
}

export interface McpToolGrantsMemoryRepos {
  mcpToolGrants: MemoryMcpToolGrantRepository;
}

export function createMcpToolGrantsMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): McpToolGrantsMemoryRepos {
  return { mcpToolGrants: new MemoryMcpToolGrantRepository(snapshot?.mcpToolGrants) };
}
