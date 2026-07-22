// ---------------------------------------------------------------------------
// MCP Audit
// ---------------------------------------------------------------------------

export interface McpAuditRow {
  audit_id: string;
  thread_id: string;
  employee_id: string;
  server_name: string;
  tool_name: string;
  arguments_json: string;
  result_json: string | null;
  error: string | null;
  latency_ms: number;
  approval_status: 'not_required' | 'human_approved' | 'human_denied';
  approved_by: string | null;
  created_at: string;
}

/** Full-row insert: caller supplies audit_id + created_at (backend does not stamp). */
export type NewMcpAudit = Omit<McpAuditRow, 'approval_status' | 'approved_by'> & {
  approval_status?: McpAuditRow['approval_status'];
  approved_by?: string | null;
};

export interface McpAuditRepository {
  create(audit: NewMcpAudit): Promise<McpAuditRow>;
  listByThread(threadId: string): Promise<McpAuditRow[]>;
  hasSuccessfulToolCall(
    threadId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<boolean>;
}

export interface McpToolGrantRow {
  grant_id: string;
  company_id: string;
  employee_id: string;
  server_name: string;
  tool_name: string;
  scope: string;
  project_id: string | null;
  risk_class: 'read' | 'write' | 'destructive' | 'open_world';
  risk_source: 'server_annotation' | 'name_heuristic' | 'human_override' | 'trusted_manifest';
  trusted_server_id: string | null;
  granted_by: string;
  created_at: string;
}

export type NewMcpToolGrant = Omit<
  McpToolGrantRow,
  'created_at' | 'risk_class' | 'risk_source' | 'trusted_server_id'
> & {
  created_at?: string;
  risk_class?: McpToolGrantRow['risk_class'];
  risk_source?: McpToolGrantRow['risk_source'];
  trusted_server_id?: string | null;
};

export interface McpToolGrantRepository {
  create(grant: NewMcpToolGrant): Promise<McpToolGrantRow>;
  listByEmployee(companyId: string, employeeId: string): Promise<McpToolGrantRow[]>;
  updateRisk(
    companyId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
    risk: Pick<McpToolGrantRow, 'risk_class' | 'risk_source' | 'trusted_server_id'>,
  ): Promise<McpToolGrantRow | null>;
  delete(
    companyId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<void>;
  hasGrant(
    companyId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<boolean>;
}

export type ToolPermissionApprovalScope = 'once' | 'thread';

export interface ToolPermissionApprovalRow {
  approval_id: string;
  thread_id: string;
  company_id: string;
  employee_id: string | null;
  server_name: string;
  tool_name: string;
  scope: ToolPermissionApprovalScope;
  approved_by: string;
  policy_hash: string;
  consumed_at: string | null;
  created_at: string;
  expires_at: string | null;
}

/** Full-row insert: caller supplies approval_id + created_at (backend does not stamp). */
export type NewToolPermissionApproval = Omit<ToolPermissionApprovalRow, never>;

export interface ToolPermissionApprovalLookup {
  threadId: string;
  companyId: string;
  serverName: string;
  toolName: string;
  employeeId?: string | null;
  policyHash?: string;
}

export interface ToolPermissionApprovalRepository {
  create(approval: NewToolPermissionApproval): Promise<ToolPermissionApprovalRow>;
  hasApproval(lookup: ToolPermissionApprovalLookup): Promise<boolean>;
  findReusableApproval(
    lookup: ToolPermissionApprovalLookup,
  ): Promise<ToolPermissionApprovalRow | null>;
  consumeApproval(approvalId: string, consumedAt: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Rack / Slot (MCP permissions)
// ---------------------------------------------------------------------------

export const RACK_STATUS = {
  unbound: 'unbound',
  bound: 'bound',
  error: 'error',
  disabled: 'disabled',
} as const;

export type RackStatus = (typeof RACK_STATUS)[keyof typeof RACK_STATUS];

export const SLOT_STATUS = {
  available: 'available',
  reserved: 'reserved',
  disabled: 'disabled',
} as const;

export type SlotStatus = (typeof SLOT_STATUS)[keyof typeof SLOT_STATUS];

export interface RackRow {
  rack_id: string;
  company_id: string;
  provider_type: string;
  label: string;
  binding_profile_json: string | null;
  status: RackStatus;
  created_at: string;
  updated_at: string;
}

export type NewRack = Omit<RackRow, 'created_at' | 'updated_at'>;

export interface SlotRow {
  slot_id: string;
  rack_id: string;
  capability_name: string;
  exposure_scope: string;
  status: SlotStatus;
  created_at: string;
  updated_at: string;
}

export type NewSlot = Omit<SlotRow, 'created_at' | 'updated_at'>;

export interface RackRepository {
  create(rack: NewRack): Promise<RackRow>;
  findById(rackId: string): Promise<RackRow | null>;
  findByCompany(companyId: string): Promise<RackRow[]>;
  updateStatus(rackId: string, status: RackStatus): Promise<void>;
  delete(rackId: string): Promise<void>;
}

export interface SlotRepository {
  create(slot: NewSlot): Promise<SlotRow>;
  findByRack(rackId: string): Promise<SlotRow[]>;
  updateStatus(slotId: string, status: SlotStatus): Promise<void>;
  delete(slotId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Workstation-Rack bindings (PRD 2.3: desk-scoped MCP permissions)
// ---------------------------------------------------------------------------

export interface WorkstationRackRow {
  workstation_id: string;
  rack_id: string;
  created_at: string;
}

export type NewWorkstationRack = Omit<WorkstationRackRow, 'created_at'>;

export interface WorkstationRackRepository {
  /** Bind a rack to a workstation. */
  create(binding: NewWorkstationRack): Promise<WorkstationRackRow>;
  /** Get all rack IDs bound to a workstation. */
  findByWorkstation(workstationId: string): Promise<WorkstationRackRow[]>;
  /** Get all workstation IDs that reference a rack. */
  findByRack(rackId: string): Promise<WorkstationRackRow[]>;
  /** Remove a binding. */
  delete(workstationId: string, rackId: string): Promise<void>;
}
