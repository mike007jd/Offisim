import type { RoleSlug } from '@offisim/shared-types';
import type {
  EmployeeCreate,
  EmployeeRepository,
  EmployeeRow,
  EmployeeVersionRepository,
  EmployeeVersionRow,
  NewEmployeeVersion,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows, now } from '../memory-utils.js';

export class MemoryEmployeeRepository implements EmployeeRepository {
  private readonly rows = new Map<string, EmployeeRow>();

  constructor(initial?: Iterable<EmployeeRow>) {
    if (initial) {
      for (const row of initial) this.rows.set(row.employee_id, { ...row });
    }
  }

  async create(emp: EmployeeCreate): Promise<{ employee_id: string }> {
    const employee_id = emp.employee_id ?? crypto.randomUUID();
    const ts = now();
    const row: EmployeeRow = {
      employee_id,
      company_id: emp.company_id,
      source_asset_id: emp.source_asset_id,
      source_package_id: emp.source_package_id,
      name: emp.name,
      role_slug: emp.role_slug as RoleSlug,
      workstation_id: null,
      persona_json: emp.persona_json ?? null,
      config_json: emp.config_json ?? null,
      model: emp.model ?? null,
      thinking_level: emp.thinking_level ?? null,
      enabled: 1,
      is_external: emp.is_external ? 1 : 0,
      a2a_url: emp.a2a_url ?? null,
      a2a_token: emp.a2a_token ?? null,
      a2a_agent_id: emp.a2a_agent_id ?? null,
      brand_key: emp.brand_key ?? null,
      agent_card_json: emp.agent_card_json ?? null,
      created_at: ts,
      updated_at: ts,
    };
    this.rows.set(employee_id, row);
    return { employee_id };
  }

  async findById(id: string): Promise<EmployeeRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findByCompany(companyId: string): Promise<EmployeeRow[]> {
    return [...this.rows.values()].filter((e) => e.company_id === companyId);
  }

  async findByRole(companyId: string, roleSlug: string): Promise<EmployeeRow[]> {
    return [...this.rows.values()].filter(
      (e) => e.company_id === companyId && e.role_slug === roleSlug,
    );
  }

  async update(employeeId: string, patch: Partial<EmployeeRow>): Promise<void> {
    const row = this.rows.get(employeeId);
    if (row) {
      this.rows.set(employeeId, { ...row, ...patch, updated_at: now() });
    }
  }

  async delete(employeeId: string): Promise<void> {
    this.rows.delete(employeeId);
  }

  seed(rows: EmployeeRow[]): void {
    for (const row of rows) this.rows.set(row.employee_id, row);
  }

  snapshot(): EmployeeRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryEmployeeVersionRepository implements EmployeeVersionRepository {
  private readonly rows: EmployeeVersionRow[] = [];

  constructor(initialRows?: Iterable<EmployeeVersionRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(version: NewEmployeeVersion): Promise<EmployeeVersionRow> {
    const row: EmployeeVersionRow = {
      ...version,
      version_id: crypto.randomUUID(),
      created_at: now(),
    };
    this.rows.push(row);
    return row;
  }

  async findByEmployee(
    employeeId: string,
    opts?: { limit?: number },
  ): Promise<EmployeeVersionRow[]> {
    const results = this.rows
      .filter((r) => r.employee_id === employeeId)
      .sort((a, b) => b.version_num - a.version_num);
    return opts?.limit ? results.slice(0, opts.limit) : results;
  }

  async findByVersion(employeeId: string, versionNum: number): Promise<EmployeeVersionRow | null> {
    return (
      this.rows.find((r) => r.employee_id === employeeId && r.version_num === versionNum) ?? null
    );
  }

  async getLatestVersionNum(employeeId: string): Promise<number> {
    const versions = this.rows.filter((r) => r.employee_id === employeeId);
    if (versions.length === 0) return 0;
    return Math.max(...versions.map((v) => v.version_num));
  }

  snapshot(): EmployeeVersionRow[] {
    return cloneRows(this.rows);
  }
}

export interface EmployeesMemoryRepos {
  employees: MemoryEmployeeRepository;
  employeeVersions: MemoryEmployeeVersionRepository;
}

export function createEmployeesMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): EmployeesMemoryRepos {
  const employees = new MemoryEmployeeRepository(snapshot?.employees);
  const employeeVersions = new MemoryEmployeeVersionRepository(snapshot?.employeeVersions);
  return { employees, employeeVersions };
}
