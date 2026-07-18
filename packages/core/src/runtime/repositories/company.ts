import type { NewEmployee } from '@offisim/install-core';
import type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
  ProjectUpdatePatch,
  RoleSlug,
} from '@offisim/shared-types';

export type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
  ProjectUpdatePatch,
} from '@offisim/shared-types';

export interface EmployeeRow {
  employee_id: string;
  company_id: string;
  source_asset_id: string | null;
  source_package_id: string | null;
  name: string;
  role_slug: RoleSlug;
  workstation_id: string | null;
  persona_json: string | null;
  config_json: string | null;
  model: string | null;
  thinking_level: string | null;
  enabled: number;
  is_external: number;
  a2a_url: string | null;
  a2a_token: string | null;
  a2a_agent_id: string | null;
  brand_key: string | null;
  agent_card_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyRow {
  company_id: string;
  name: string;
  status: string;
  template_id: string | null;
  template_label: string | null;
  workspace_root: string | null;
  description_json: string | null;
  created_at: string;
  updated_at: string;
}

/** Repository interfaces */

export interface CompanyRepository {
  findById(companyId: string): Promise<CompanyRow | null>;
  findAll(): Promise<CompanyRow[]>;
  create(company: CompanyRow): Promise<CompanyRow>;
  update(
    companyId: string,
    fields: Partial<
      Pick<CompanyRow, 'name' | 'status' | 'template_id' | 'template_label' | 'description_json'>
    >,
  ): Promise<void>;
}

/** Updatable fields for an employee. */
export type EmployeeUpdate = Partial<
  Pick<
    EmployeeRow,
    | 'name'
    | 'role_slug'
    | 'persona_json'
    | 'config_json'
    | 'model'
    | 'thinking_level'
    | 'enabled'
    | 'workstation_id'
    | 'is_external'
    | 'a2a_url'
    | 'a2a_token'
    | 'a2a_agent_id'
    | 'brand_key'
    | 'agent_card_json'
  >
>;

/** Employee creation fields owned by the local runtime. Install templates keep
 * using NewEmployee without model presets; Personnel may add an explicit bind. */
export type EmployeeCreate = NewEmployee & {
  readonly model?: string | null;
  readonly thinking_level?: string | null;
};

export interface EmployeeRepository {
  create(employee: EmployeeCreate): Promise<{ employee_id: string }>;
  findById(employeeId: string): Promise<EmployeeRow | null>;
  findByCompany(companyId: string): Promise<EmployeeRow[]>;
  findByRole(companyId: string, roleSlug: RoleSlug): Promise<EmployeeRow[]>;
  /** Update employee fields. */
  update(employeeId: string, patch: EmployeeUpdate): Promise<void>;
  /** Delete an employee by ID. Used during install rollback. */
  delete(employeeId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Employee version history
// ---------------------------------------------------------------------------

export type EmployeeVersionChangeType = 'create' | 'update' | 'rollback';

export interface EmployeeVersionRow {
  version_id: string;
  employee_id: string;
  version_num: number;
  change_type: EmployeeVersionChangeType;
  snapshot_json: string;
  change_summary: string | null;
  created_by: string;
  created_at: string;
}

export type NewEmployeeVersion = Omit<EmployeeVersionRow, 'version_id' | 'created_at'>;

export interface EmployeeVersionRepository {
  create(version: NewEmployeeVersion): Promise<EmployeeVersionRow>;
  findByEmployee(employeeId: string, opts?: { limit?: number }): Promise<EmployeeVersionRow[]>;
  findByVersion(employeeId: string, versionNum: number): Promise<EmployeeVersionRow | null>;
  getLatestVersionNum(employeeId: string): Promise<number>;
}

export interface CompanyTemplateAssetRow {
  company_template_asset_id: string;
  company_id: string;
  template_id: string;
  name: string;
  description: string;
  template_json: string;
  source_package_id: string;
  source_asset_id: string;
  version: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCompanyTemplateAsset = Omit<CompanyTemplateAssetRow, 'created_at' | 'updated_at'>;

export interface CompanyTemplateAssetRepository {
  create(template: NewCompanyTemplateAsset): Promise<CompanyTemplateAssetRow>;
  findById(companyTemplateAssetId: string): Promise<CompanyTemplateAssetRow | null>;
  findByCompany(companyId: string): Promise<CompanyTemplateAssetRow[]>;
  delete(companyTemplateAssetId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Workstations (employee desk/seat anchors; zone-level rows use the zone id)
// ---------------------------------------------------------------------------

export interface WorkstationRow {
  workstation_id: string;
  company_id: string;
  room_type: string;
  label: string;
  position_json: string | null;
  seat_capacity: number;
  created_at: string;
  updated_at: string;
}

export type NewWorkstation = Omit<WorkstationRow, 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};

export interface WorkstationRepository {
  /**
   * Create or update a workstation. Zone-level home workstations use the zone id
   * as the workstation id, so the office scene resolves an employee's seat by
   * matching `employee.workstation_id === zone.zone_id`.
   */
  upsert(workstation: NewWorkstation): Promise<WorkstationRow>;
  findById(workstationId: string): Promise<WorkstationRow | null>;
  findByCompany(companyId: string): Promise<WorkstationRow[]>;
}

// ---------------------------------------------------------------------------
// Office layouts
// ---------------------------------------------------------------------------

export interface OfficeLayoutRow {
  layout_id: string;
  company_id: string;
  name: string;
  layout_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type NewOfficeLayout = Omit<OfficeLayoutRow, 'created_at' | 'updated_at'>;

export interface OfficeLayoutRepository {
  create(layout: NewOfficeLayout): Promise<OfficeLayoutRow>;
  findById(layoutId: string): Promise<OfficeLayoutRow | null>;
  findByCompany(companyId: string): Promise<OfficeLayoutRow[]>;
  findActive(companyId: string): Promise<OfficeLayoutRow | null>;
  setActive(companyId: string, layoutId: string): Promise<void>;
  update(
    layoutId: string,
    patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>,
  ): Promise<void>;
  delete(layoutId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRepository {
  create(project: NewProject): Promise<ProjectRow>;
  findById(projectId: string): Promise<ProjectRow | null>;
  findByCompany(companyId: string): Promise<ProjectRow[]>;
  findActiveByCompany(companyId: string): Promise<ProjectRow[]>;
  updateStatus(projectId: string, status: ProjectStatus): Promise<void>;
  /** Patch a project. `workspace_root` is always a canonical, non-empty folder path. */
  update(projectId: string, patch: ProjectUpdatePatch): Promise<void>;
}

// ---------------------------------------------------------------------------
// Project assignments
// ---------------------------------------------------------------------------

export interface ProjectAssignmentRepository {
  assign(assignment: NewProjectAssignment): Promise<ProjectAssignmentRow>;
  unassign(projectId: string, employeeId: string): Promise<void>;
  findByProject(projectId: string): Promise<ProjectAssignmentRow[]>;
  findByEmployee(employeeId: string): Promise<ProjectAssignmentRow[]>;
  isAssigned(projectId: string, employeeId: string): Promise<boolean>;
}
