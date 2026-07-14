import { invokeCommand } from '@/lib/tauri-commands.js';
import { titleizeSlug } from '@/lib/utils.js';
import type { EmployeeRow, McpToolGrantRow, RuntimeRepositories } from '@offisim/core/browser';
import type { DelegationRosterEntry } from '@offisim/shared-types';
import { inferMcpGrantRiskClass } from './mcp-risk.js';

/**
 * Canonical employee system prompt.
 *
 * Both the Personnel "System prompt" preview and the live Pi session render
 * from this single builder, so what the user reads in the inspector is exactly
 * what the employee's Pi sessions receive (forwarded as the session's
 * `appendSystemPrompt`). Persona is a real, generic agent capability — a system
 * prompt addendum — not a Pi-specific control.
 */
export interface EmployeePersonaInput {
  name: string;
  role: string;
  companyName: string;
  expertise: string;
  workingStyle: string;
  communication: string;
  risk: string;
  decisionStyle: string;
  customInstructions: string;
}

export function buildEmployeeSystemPrompt(persona: EmployeePersonaInput): string {
  const company = persona.companyName.trim() || 'the company';
  const lines = [
    `You are ${persona.name || 'this employee'}, a ${persona.role || 'teammate'} at ${company}.`,
    '',
    `Expertise: ${persona.expertise || '—'}`,
    `Working style: ${persona.workingStyle || '—'}`,
    `Communication frequency: ${persona.communication} · Risk preference: ${persona.risk}`,
    `Decision style: ${persona.decisionStyle}`,
  ];
  if (persona.customInstructions.trim()) {
    lines.push('', '## Custom instructions', persona.customInstructions.trim());
  }
  lines.push(
    '',
    'Follow company playbooks. Produce reviewable, minimal diffs. Surface risks before',
    'acting on irreversible changes.',
  );
  return lines.join('\n');
}

function asPersonaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(', ');
  return '';
}

function readProfile(personaJson: string | null | undefined): Record<string, unknown> {
  if (!personaJson) return {};
  try {
    const parsed = JSON.parse(personaJson) as Record<string, unknown>;
    const profile = parsed?.profile;
    return profile && typeof profile === 'object' && !Array.isArray(profile)
      ? (profile as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Human role title stored at persona_json top level by template materialization
 *  (e.g. "Orchestrator") — surfaced to the root agent's teammate roster. */
function readDisplayTitle(personaJson: string | null | undefined): string | undefined {
  if (!personaJson) return undefined;
  try {
    const parsed = JSON.parse(personaJson) as Record<string, unknown>;
    return typeof parsed.displayTitle === 'string' && parsed.displayTitle.trim()
      ? parsed.displayTitle.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Build the system-prompt text for an already-loaded employee row + company name. */
function personaFromRow(employee: EmployeeRow, companyName: string): string {
  const profile = readProfile(employee.persona_json);
  return buildEmployeeSystemPrompt({
    name: employee.name ?? '',
    role: titleizeSlug(employee.role_slug),
    companyName,
    expertise: asPersonaText(profile.expertise),
    workingStyle: asPersonaText(profile.workingStyle),
    communication: asPersonaText(profile.communication) || 'medium',
    risk: asPersonaText(profile.risk) || 'balanced',
    decisionStyle: asPersonaText(profile.decisionStyle) || 'collaborative',
    customInstructions: asPersonaText(profile.customInstructions),
  });
}

/** A teammate the root agent may delegate to. Opaque on the wire; the Node host's
 *  supervisor builds an in-process child session from it. Excludes the acting
 *  employee and external (A2A) employees — those aren't in-process Pi children. */
/** Everything a turn needs to brief the root agent and its potential teammates:
 *  the acting employee's own persona (Pi's `appendSystemPrompt`) plus the
 *  delegation roster. */
export interface DelegationContext {
  /** The acting employee's system prompt, or null (→ Pi base prompt) if absent. */
  systemPromptAppend: string | null;
  /** Acting employee's effective company + personal SKILL.md paths. */
  skillPaths: string[];
  /** Effective model/effort for this acting employee after stale-binding fallback. */
  runtimeSelection: EmployeeRuntimeSelection;
  roster: DelegationRosterEntry[];
}

export interface EmployeeRuntimeSelection {
  model?: string;
  thinkingLevel?: string;
}

interface RuntimeModelSummaryLike {
  runtimeModelRef?: string;
}

/**
 * Employee bindings override the inherited conversation selection only while the
 * selected account still exposes the exact adapter model reference. A stale
 * binding behaves like no binding and keeps both inherited fields.
 */
export function resolveEmployeeRuntimeSelection(
  employee: Pick<EmployeeRow, 'model' | 'thinking_level'> | null,
  availableModels: readonly RuntimeModelSummaryLike[],
  inherited: EmployeeRuntimeSelection,
): EmployeeRuntimeSelection {
  const model = employee?.model?.trim();
  const validModels = new Set(
    availableModels
      .map((availableModel) => availableModel.runtimeModelRef?.trim())
      .filter((runtimeModelRef): runtimeModelRef is string => Boolean(runtimeModelRef)),
  );
  if (!model || !validModels.has(model)) return inherited;
  const thinkingLevel = employee?.thinking_level?.trim() || inherited.thinkingLevel;
  return {
    model,
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}

function absoluteVaultSkillPath(root: string, vaultPath: string): string {
  const cleanRoot = root.replace(/\/+$/u, '');
  const cleanPath = vaultPath.trim().replace(/^\/+/, '');
  if (
    !cleanPath.endsWith('/SKILL.md') ||
    cleanPath.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error(`Invalid indexed skill vault path: ${vaultPath}`);
  }
  return `${cleanRoot}/${cleanPath}`;
}

export interface McpScopedTool {
  name: string;
  server: string;
  category?: 'computer-use';
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  write?: boolean;
  riskClass?: McpToolGrantRow['risk_class'];
  riskSource?: McpToolGrantRow['risk_source'];
  trustedServerId?: string | null;
}

interface RuntimeMcpToolInfo {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  input_schema?: unknown;
  annotations?: unknown;
  category?: unknown;
}

interface RuntimeMcpServerStatus {
  name?: unknown;
  state?: unknown;
  tools?: RuntimeMcpToolInfo[];
}

/**
 * Build a turn's full delegation context in ONE pass: a single `findByCompany`
 * (all employee rows) + a single company read derives both the acting employee's
 * persona and the roster of delegable teammates — no per-employee re-read, and no
 * second fetch of the company row. The acting employee's persona resolves even if
 * disabled/external (matches the previous by-id lookup); the roster excludes the
 * acting employee and external (A2A) employees.
 */
export async function buildDelegationContext(
  repos: RuntimeRepositories,
  companyId: string,
  actingEmployeeId: string | null,
  inheritedRuntime: EmployeeRuntimeSelection = {},
): Promise<DelegationContext> {
  const [employees, company, skills, vaultStatus, runtimeStatus] = await Promise.all([
    repos.employees.findByCompany(companyId),
    repos.companies.findById(companyId).catch(() => null),
    repos.skills.listByCompany(companyId),
    invokeCommand('runtime_vault_status'),
    actingEmployeeId
      ? invokeCommand('agent_runtime_status').catch(() => null)
      : Promise.resolve(null),
  ]);
  const vaultRoot = vaultStatus.path;
  const companySkillPaths = skills
    .filter((skill) => skill.employee_id === null)
    .map((skill) => absoluteVaultSkillPath(vaultRoot, skill.vault_path));
  const skillPathsForEmployee = (employeeId: string | null): string[] => [
    ...companySkillPaths,
    ...skills
      .filter((skill) => skill.employee_id === employeeId)
      .map((skill) => absoluteVaultSkillPath(vaultRoot, skill.vault_path)),
  ];
  const companyName = company?.name ?? '';
  const acting = actingEmployeeId
    ? (employees.find((e) => e.employee_id === actingEmployeeId) ?? null)
    : null;
  const roster = employees
    .filter((e) => e.enabled === 1 && e.is_external !== 1 && e.employee_id !== actingEmployeeId)
    .map((e) => {
      const model = e.model?.trim();
      const thinkingLevel = e.thinking_level?.trim();
      const displayTitle = readDisplayTitle(e.persona_json);
      return {
        employeeId: e.employee_id,
        name: e.name ?? e.employee_id,
        roleSlug: e.role_slug,
        persona: personaFromRow(e, companyName),
        ...(displayTitle ? { displayTitle } : {}),
        ...(model ? { model } : {}),
        ...(model && thinkingLevel ? { thinkingLevel } : {}),
        skillPaths: skillPathsForEmployee(e.employee_id),
      };
    });
  return {
    systemPromptAppend: acting ? personaFromRow(acting, companyName) : null,
    skillPaths: acting ? skillPathsForEmployee(acting.employee_id) : companySkillPaths,
    runtimeSelection: resolveEmployeeRuntimeSelection(
      acting,
      runtimeStatus?.models ?? [],
      inheritedRuntime,
    ),
    roster,
  };
}

export async function buildMcpScope(
  repos: RuntimeRepositories,
  companyId: string,
  employeeId: string | null,
  projectId?: string | null,
  _missionId?: string | null,
): Promise<McpScopedTool[]> {
  if (!employeeId) return [];
  let grants: McpToolGrantRow[];
  try {
    grants = await repos.mcpToolGrants.listByEmployee(companyId, employeeId);
  } catch {
    return [];
  }
  const scopedGrants = grants.filter(
    (grant) => !grant.project_id || grant.project_id === projectId,
  );
  if (scopedGrants.length === 0) return [];
  try {
    const statuses = await ensureGrantedMcpServersConnected(scopedGrants);
    const connected = new Map(
      statuses
        .filter((server) => server.state === 'ready' && typeof server.name === 'string')
        .map((server) => [server.name as string, server] as const),
    );
    const scoped: McpScopedTool[] = [];
    for (const grant of scopedGrants) {
      const server = connected.get(grant.server_name);
      if (!server) {
        continue;
      }
      const tool = (server.tools ?? []).find((candidate) => candidate.name === grant.tool_name);
      scoped.push(toMcpScopedTool(grant, tool));
    }
    return scoped;
  } catch {
    return [];
  }
}

async function ensureGrantedMcpServersConnected(
  grants: readonly { server_name: string }[],
): Promise<RuntimeMcpServerStatus[]> {
  const statuses = await invokeCommand('mcp_list_servers');
  const ready = new Set(
    statuses
      .filter((server) => server.state === 'ready' && typeof server.name === 'string')
      .map((server) => server.name as string),
  );
  const needed = new Set(
    grants.map((grant) => grant.server_name).filter((name) => !ready.has(name)),
  );
  if (needed.size === 0) return statuses;

  const registered = await invokeCommand('mcp_list_registered_servers');
  await Promise.all(
    registered
      .filter((server) => typeof server.name === 'string' && needed.has(server.name))
      .map(async (server) => {
        if (
          server.transport !== 'stdio' ||
          typeof server.serverId !== 'string' ||
          typeof server.approvalId !== 'string' ||
          typeof server.commandFingerprint !== 'string'
        ) {
          return;
        }
        await invokeCommand('mcp_connect_registered', {
          request: {
            serverId: server.serverId,
            approvalId: server.approvalId,
            commandFingerprint: server.commandFingerprint,
            projectId: null,
            requestSurface:
              typeof server.requestSurface === 'string' ? server.requestSurface : 'settings',
            sourcePackageId:
              typeof server.sourcePackageId === 'string' ? server.sourcePackageId : null,
            sourcePackageVersion:
              typeof server.sourcePackageVersion === 'string' ? server.sourcePackageVersion : null,
            sourceManifestHash:
              typeof server.sourceManifestHash === 'string' ? server.sourceManifestHash : null,
          },
        }).catch(() => undefined);
      }),
  );
  return invokeCommand('mcp_list_servers');
}

function toMcpScopedTool(grant: McpToolGrantRow, tool?: RuntimeMcpToolInfo): McpScopedTool {
  const annotations =
    tool?.annotations && typeof tool.annotations === 'object'
      ? normalizeMcpAnnotations(tool.annotations as Record<string, unknown>)
      : {};
  const effectiveRisk =
    grant.risk_class ??
    inferMcpGrantRiskClass({
      name: grant.tool_name,
      ...(tool?.category === 'computer-use' ? { category: 'computer-use' as const } : {}),
      annotations,
    });
  return {
    name: grant.tool_name,
    server: grant.server_name,
    ...(typeof tool?.description === 'string' ? { description: tool.description } : {}),
    ...(tool?.category === 'computer-use' ? { category: 'computer-use' as const } : {}),
    inputSchema: tool?.inputSchema ?? tool?.input_schema ?? {},
    annotations,
    write: effectiveRisk !== 'read',
    riskClass: effectiveRisk,
    riskSource: grant.risk_source ?? 'name_heuristic',
    trustedServerId: grant.trusted_server_id ?? null,
  };
}

function normalizeMcpAnnotations(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    readOnlyHint: raw.readOnlyHint ?? raw.read_only_hint,
    destructiveHint: raw.destructiveHint ?? raw.destructive_hint,
    idempotentHint: raw.idempotentHint ?? raw.idempotent_hint,
    openWorldHint: raw.openWorldHint ?? raw.open_world_hint,
  };
}
