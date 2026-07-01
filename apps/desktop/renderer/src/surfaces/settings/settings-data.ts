import { isTauriRuntime, reposOrNull } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { inferMcpGrantRiskClass } from '@/data/mcp-risk.js';
/**
 * Settings-surface view-models, fixtures, and local query hooks.
 *
 * This file is the data SSOT for the Settings surface only. Every shape here is a
 * Settings-local view-model (runtime defaults, MCP servers, external employees,
 * vault status). It deliberately does not reach into
 * `src/data/**` for visual contracts. External employees are the exception:
 * release builds read the real employee repository because A2A peers are part
 * of the company roster.
 */
import { resolveAsync } from '@/lib/platform.js';
import type {
  EmployeeRow,
  McpToolGrantRow,
  NewMcpAudit,
  NewMcpToolGrant,
} from '@offisim/core/browser';
import { readResponseTextWithLimit } from '@offisim/registry-client';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

export { inferMcpGrantRiskClass, inferMcpGrantRiskSource } from '@/data/mcp-risk.js';

// ───────────────────────── Appearance ─────────────────────────

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;
export type ThemeValue = (typeof THEME_OPTIONS)[number]['value'];

const DENSITY_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'spacious', label: 'Spacious' },
] as const;
export type DensityValue = (typeof DENSITY_OPTIONS)[number]['value'];

// ───────────────────────── MCP ─────────────────────────

export type McpTransport = 'stdio' | 'sse';
export type McpStatus = 'connected' | 'disconnected' | 'connecting' | 'registered';
type McpSource = 'user-config' | 'workspace' | 'defaults' | 'installed-asset' | 'developer-runtime';

export interface McpServer {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransport;
  readonly status: McpStatus;
  readonly source: McpSource;
  readonly command: string;
  readonly approvalId: string;
  readonly commandFingerprint?: string;
  readonly toolCount?: number;
  readonly tools: readonly McpToolInfo[];
  readonly requestedTools: readonly string[];
  readonly riskyTools: readonly string[];
}

export const MCP_STATUS_LABELS: Record<McpStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  registered: 'Registered',
};

export const mcpServerSchema = z
  .object({
    transport: z.enum(['stdio', 'sse']),
    name: z.string().min(1, 'Server name is required'),
    approvalId: z.string(),
    command: z.string(),
    url: z.string(),
    args: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.transport === 'stdio' && value.command.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message: 'Command is required for stdio',
      });
    }
    if (value.transport === 'sse' && value.url.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'Endpoint URL is required for SSE',
      });
    }
  });
export type McpServerFormValues = z.infer<typeof mcpServerSchema>;

export const MCP_SERVER_DEFAULTS: McpServerFormValues = {
  transport: 'stdio',
  name: '',
  approvalId: '',
  command: '',
  url: '',
  args: '',
};

type TauriMcpTransport = 'stdio' | 'sse';

interface RegisteredMcpServerSummary {
  serverId: string;
  name: string;
  transport: TauriMcpTransport;
  command?: string | null;
  args?: string[];
  url?: string | null;
  source?: string | null;
  approvalId?: string | null;
  riskClass?: string | null;
  commandFingerprint?: string | null;
  requestedTools?: string[];
}

interface McpServerStatusRow {
  name: string;
  state: string;
  toolCount: number;
  tools?: McpToolInfo[];
}

interface McpSpawnResult {
  serverName: string;
  state: string;
  tools: McpToolInfo[];
}

interface McpToolCallResult {
  content: unknown;
  isError: boolean;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } | null;
}

export interface McpToolGrant {
  readonly id: string;
  readonly companyId: string;
  readonly employeeId: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly scope: string;
  readonly projectId: string | null;
  readonly riskClass: McpToolGrantRow['risk_class'];
  readonly riskSource: McpToolGrantRow['risk_source'];
  readonly trustedServerId: string | null;
  readonly grantedBy: string;
  readonly createdAt: string;
}

function normalizeMcpSource(source: string | null | undefined): McpSource {
  if (
    source === 'workspace' ||
    source === 'defaults' ||
    source === 'user-config' ||
    source === 'installed-asset' ||
    source === 'developer-runtime'
  ) {
    return source;
  }
  return 'user-config';
}

function mcpDisplayCommand(server: RegisteredMcpServerSummary): string {
  if (server.transport === 'sse') return server.url ?? '';
  return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
}

function mcpStatusFromRuntime(
  server: RegisteredMcpServerSummary,
  statuses: ReadonlyMap<string, McpServerStatusRow>,
): McpStatus {
  const runtime = statuses.get(server.name);
  if (!runtime) return 'registered';
  if (runtime.state === 'ready') return 'connected';
  if (runtime.state === 'starting') return 'connecting';
  return 'disconnected';
}

function mcpServerFromRegistered(
  server: RegisteredMcpServerSummary,
  statuses: ReadonlyMap<string, McpServerStatusRow>,
): McpServer {
  const runtime = statuses.get(server.name);
  const tools = runtime?.tools ?? [];
  return {
    id: server.serverId,
    name: server.name,
    transport: server.transport,
    status: mcpStatusFromRuntime(server, statuses),
    source: normalizeMcpSource(server.source),
    command: mcpDisplayCommand(server),
    approvalId: server.approvalId ?? '',
    commandFingerprint: server.commandFingerprint ?? undefined,
    toolCount: runtime?.toolCount ?? tools.length,
    tools,
    requestedTools: server.requestedTools ?? [],
    riskyTools: server.riskClass === 'high' ? (server.requestedTools ?? []) : [],
  };
}

export function isWriteMcpTool(tool: Pick<McpToolInfo, 'name' | 'annotations'>): boolean {
  return inferMcpGrantRiskClass(tool) !== 'read';
}

function argsFromForm(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function approvalIdFor(values: Pick<McpServerFormValues, 'name' | 'approvalId'>): string {
  return values.approvalId.trim() || `mcp.${values.name.trim()}.default`;
}

async function loadMcpServers(): Promise<McpServer[]> {
  if (!isTauriRuntime()) return resolveAsync([]);
  const { invoke } = await import('@tauri-apps/api/core');
  const [registered, runtimeStatuses] = await Promise.all([
    invoke<RegisteredMcpServerSummary[]>('mcp_list_registered_servers'),
    invoke<McpServerStatusRow[]>('mcp_list_servers'),
  ]);
  const statuses = new Map(runtimeStatuses.map((status) => [status.name, status] as const));
  return registered.map((server) => mcpServerFromRegistered(server, statuses));
}

export async function registerMcpServer(values: McpServerFormValues): Promise<McpServer> {
  const { invoke } = await import('@tauri-apps/api/core');
  const registered = await invoke<RegisteredMcpServerSummary>('mcp_register_server', {
    input: {
      name: values.name.trim(),
      transport: values.transport,
      command: values.transport === 'stdio' ? values.command.trim() : null,
      args: values.transport === 'stdio' ? argsFromForm(values.args) : [],
      url: values.transport === 'sse' ? values.url.trim() : null,
      source: 'user-config',
      approvalId: approvalIdFor(values),
      riskClass: values.transport === 'stdio' ? 'high' : 'medium',
      requestedTools: [],
      requestSurface: 'settings',
    },
  });
  return mcpServerFromRegistered(registered, new Map());
}

export async function connectMcpServer(server: McpServer): Promise<McpSpawnResult> {
  if (server.transport !== 'stdio') {
    throw new Error(
      'SSE MCP servers are registered here and connect from the desktop WebView client.',
    );
  }
  if (!server.approvalId || !server.commandFingerprint) {
    throw new Error('Registered stdio server is missing approval or command fingerprint.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<McpSpawnResult>('mcp_connect_registered', {
    request: {
      serverId: server.id,
      approvalId: server.approvalId,
      commandFingerprint: server.commandFingerprint,
      projectId: null,
      requestSurface: 'settings',
      sourcePackageId: null,
      sourcePackageVersion: null,
      sourceManifestHash: null,
    },
  });
}

export async function unregisterMcpServer(server: McpServer): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  if (server.transport === 'stdio') {
    await invoke('mcp_kill', { server: server.name }).catch(() => undefined);
  }
  await invoke('mcp_unregister_server', { serverId: server.id });
}

function mcpToolGrantFromRow(row: McpToolGrantRow): McpToolGrant {
  return {
    id: row.grant_id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    serverName: row.server_name,
    toolName: row.tool_name,
    scope: row.scope,
    projectId: row.project_id,
    riskClass: row.risk_class,
    riskSource: row.risk_source,
    trustedServerId: row.trusted_server_id,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
  };
}

async function loadMcpToolGrants(companyId: string, employeeId: string): Promise<McpToolGrant[]> {
  const repos = await reposOrNull();
  if (!repos?.mcpToolGrants) return [];
  const rows = await repos.mcpToolGrants.listByEmployee(companyId, employeeId);
  return rows.map(mcpToolGrantFromRow);
}

export async function grantMcpTool(input: {
  companyId: string;
  employeeId: string;
  serverName: string;
  toolName: string;
  projectId?: string | null;
  riskClass: McpToolGrantRow['risk_class'];
  riskSource?: McpToolGrantRow['risk_source'];
  trustedServerId?: string | null;
  grantedBy?: string;
}): Promise<McpToolGrant> {
  const repos = await reposOrNull();
  if (!repos?.mcpToolGrants) throw new Error('MCP grants repository is unavailable.');
  const row: NewMcpToolGrant = {
    grant_id: crypto.randomUUID(),
    company_id: input.companyId,
    employee_id: input.employeeId,
    server_name: input.serverName,
    tool_name: input.toolName,
    scope: input.projectId ? 'project' : 'employee',
    project_id: input.projectId ?? null,
    risk_class: input.riskClass,
    risk_source: input.riskSource ?? 'human_override',
    trusted_server_id: input.trustedServerId ?? null,
    granted_by: input.grantedBy ?? 'boss',
  };
  return mcpToolGrantFromRow(await repos.mcpToolGrants.create(row));
}

export async function updateMcpToolGrantRisk(input: {
  companyId: string;
  employeeId: string;
  serverName: string;
  toolName: string;
  riskClass: McpToolGrantRow['risk_class'];
  riskSource: McpToolGrantRow['risk_source'];
  trustedServerId?: string | null;
}): Promise<McpToolGrant | null> {
  const repos = await reposOrNull();
  if (!repos?.mcpToolGrants) throw new Error('MCP grants repository is unavailable.');
  const row = await repos.mcpToolGrants.updateRisk(
    input.companyId,
    input.employeeId,
    input.serverName,
    input.toolName,
    {
      risk_class: input.riskClass,
      risk_source: input.riskSource,
      trusted_server_id: input.trustedServerId ?? null,
    },
  );
  return row ? mcpToolGrantFromRow(row) : null;
}

export async function revokeMcpTool(input: {
  companyId: string;
  employeeId: string;
  serverName: string;
  toolName: string;
}): Promise<void> {
  const repos = await reposOrNull();
  if (!repos?.mcpToolGrants) return;
  await repos.mcpToolGrants.delete(
    input.companyId,
    input.employeeId,
    input.serverName,
    input.toolName,
  );
}

function parseToolArguments(value: string): unknown {
  const trimmed = value
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/[\u2018\u2019]/gu, "'")
    .trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object.');
  }
  return parsed;
}

async function writeMcpTestAudit(input: {
  employeeId: string;
  serverName: string;
  toolName: string;
  argumentsValue: unknown;
  resultValue: unknown;
  error: string | null;
  latencyMs: number;
}): Promise<void> {
  const repos = await reposOrNull();
  if (!repos?.mcpAudit) return;
  const row: NewMcpAudit = {
    audit_id: crypto.randomUUID(),
    thread_id: `settings:mcp-test:${input.serverName}`,
    task_run_id: null,
    employee_id: input.employeeId,
    server_name: input.serverName,
    tool_name: input.toolName,
    arguments_json: JSON.stringify(input.argumentsValue),
    result_json: JSON.stringify(input.resultValue),
    error: input.error,
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
    approval_status: 'human_approved',
    approved_by: 'boss',
    created_at: new Date().toISOString(),
  };
  await repos.mcpAudit.create(row);
}

export async function testMcpTool(input: {
  serverName: string;
  toolName: string;
  argsText: string;
  employeeId?: string | null;
}): Promise<McpToolCallResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  const argumentsValue = parseToolArguments(input.argsText);
  const started = performance.now();
  const employeeId = input.employeeId?.trim() || 'settings';
  try {
    const result = await invoke<McpToolCallResult>('mcp_call_tool', {
      server: input.serverName,
      tool: input.toolName,
      arguments: argumentsValue,
    });
    await writeMcpTestAudit({
      employeeId,
      serverName: input.serverName,
      toolName: input.toolName,
      argumentsValue,
      resultValue: result.content ?? null,
      error: result.isError ? 'mcp tool returned isError' : null,
      latencyMs: performance.now() - started,
    });
    return result;
  } catch (error) {
    await writeMcpTestAudit({
      employeeId,
      serverName: input.serverName,
      toolName: input.toolName,
      argumentsValue,
      resultValue: null,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: performance.now() - started,
    });
    throw error;
  }
}

// ───────────────────────── External Employees ─────────────────────────

export interface ExternalEmployee {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly brandGradient: readonly [string, string];
  readonly logoMark: string;
  readonly role: string;
  readonly cardUrl: string;
  readonly url: string;
  readonly cardLabel: string;
  readonly connected: boolean;
  readonly installedAt: number;
}

const EXTERNAL_EMPLOYEES_FIXTURE: readonly ExternalEmployee[] = [
  {
    id: 'otto',
    name: 'Otto Reeves',
    brand: 'OpenClaw',
    brandGradient: [UI_DATA_COLORS.hot1, UI_DATA_COLORS.hot2],
    logoMark: 'O',
    role: 'research-analyst',
    cardUrl: 'https://agent.openclaw.ai/.well-known/agent.json',
    url: 'https://agent.openclaw.ai/a2a',
    cardLabel: 'OpenClaw Research · v2.4.1',
    connected: true,
    installedAt: 3,
  },
  {
    id: 'hermes',
    name: 'Hermes Ops',
    brand: 'Hermes',
    brandGradient: [UI_DATA_COLORS.violet, UI_DATA_COLORS.blue3],
    logoMark: 'H',
    role: 'ops-runner',
    cardUrl: 'https://hermes.run/.well-known/agent.json',
    url: 'https://hermes.run/v1/a2a',
    cardLabel: 'Hermes · v1.9.0',
    connected: true,
    installedAt: 2,
  },
  {
    id: 'codex',
    name: 'Codex Worker',
    brand: 'Codex',
    brandGradient: [UI_DATA_COLORS.green, UI_DATA_COLORS.green2],
    logoMark: 'C',
    role: 'code-writer',
    cardUrl: 'https://a2a.local:7878/.well-known/agent.json',
    url: 'https://a2a.local:7878',
    cardLabel: 'Codex · custom',
    connected: true,
    installedAt: 1,
  },
];

export interface DiscoveredCard {
  readonly name: string;
  readonly description: string;
  readonly brand: string;
  readonly brandGradient: readonly [string, string];
  readonly logoMark: string;
  readonly interfaces: string;
  readonly roleDefault: string;
  readonly sourceUrl: string;
  readonly endpoint: string;
}

const MAX_AGENT_CARD_BYTES = 256 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function endpointFromCard(card: Record<string, unknown>, fallbackUrl: URL): string {
  const direct = firstString(card, ['url', 'endpoint', 'rpcUrl', 'jsonRpcUrl']);
  if (direct) return direct;

  const endpoints = card.endpoints;
  if (Array.isArray(endpoints)) {
    for (const endpoint of endpoints) {
      const endpointRecord = asRecord(endpoint);
      const endpointUrl = endpointRecord ? firstString(endpointRecord, ['url', 'href']) : null;
      if (endpointUrl) return endpointUrl;
    }
  }

  return fallbackUrl.href.replace(/\/\.well-known\/agent\.json$/u, '/a2a');
}

function agentInterfaces(card: Record<string, unknown>): string {
  const parts = new Set<string>();
  const protocol = firstString(card, ['protocolVersion', 'protocol', 'preferredTransport']);
  if (protocol) parts.add(protocol);

  const capabilities = asRecord(card.capabilities);
  if (capabilities?.streaming === true) parts.add('streaming');
  if (capabilities?.pushNotifications === true) parts.add('push');
  if (capabilities?.stateTransitionHistory === true) parts.add('history');

  return [...parts].join(' · ') || 'a2a/jsonrpc';
}

function brandFromCard(card: Record<string, unknown>, fallbackUrl: URL): string {
  const provider = asRecord(card.provider);
  return (
    firstString(card, ['brand', 'providerName', 'organization']) ??
    (provider ? firstString(provider, ['name', 'organization']) : null) ??
    fallbackUrl.hostname.replace(/^www\./u, '')
  );
}

function roleFromCard(card: Record<string, unknown>): string {
  const skills = card.skills;
  if (Array.isArray(skills)) {
    const firstSkill = asRecord(skills[0]);
    const skillName = firstSkill ? firstString(firstSkill, ['name', 'id']) : null;
    if (skillName)
      return skillName
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '');
  }
  return 'external-agent';
}

function brandGradient(seed: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const pairIndex = Math.abs(hash) % 4;
  const fallbackPair: readonly [string, string] = [UI_DATA_COLORS.hot1, UI_DATA_COLORS.hot2];
  const pairs: readonly (readonly [string, string])[] = [
    fallbackPair,
    [UI_DATA_COLORS.blue, UI_DATA_COLORS.blueViolet],
    [UI_DATA_COLORS.green, UI_DATA_COLORS.green2],
    [UI_DATA_COLORS.amber3, UI_DATA_COLORS.amber4],
  ];
  return pairs[pairIndex] ?? fallbackPair;
}

export async function discoverAgentCard(url: string): Promise<DiscoveredCard> {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error('Agent card URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Agent card URL is invalid');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Agent card must use http or https');
  }

  const controller = new AbortController();
  const response = await fetch(parsed.href, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: controller.signal,
  });
  if (!response.ok) {
    throw new Error(`Agent card returned HTTP ${response.status}`);
  }

  const text = await readResponseTextWithLimit(response, MAX_AGENT_CARD_BYTES, {
    abortController: controller,
    allowTextFallback: true,
    tooLargeMessage: 'Agent card is too large',
  });

  const card = asRecord(JSON.parse(text));
  if (!card) throw new Error('Agent card must be a JSON object');

  const brand = brandFromCard(card, parsed);
  const name = firstString(card, ['name', 'displayName', 'title']) ?? brand;
  const description = firstString(card, ['description', 'summary']) ?? 'External A2A agent card.';

  return {
    name,
    description,
    brand,
    brandGradient: brandGradient(brand),
    logoMark: (name[0] ?? brand[0] ?? 'A').toUpperCase(),
    interfaces: agentInterfaces(card),
    roleDefault: roleFromCard(card),
    sourceUrl: parsed.href,
    endpoint: endpointFromCard(card, parsed),
  };
}

function externalEmployeeFromRow(row: EmployeeRow): ExternalEmployee {
  let card: Partial<DiscoveredCard> = {};
  try {
    const parsed = row.agent_card_json ? JSON.parse(row.agent_card_json) : null;
    if (parsed && typeof parsed === 'object') card = parsed as Partial<DiscoveredCard>;
  } catch {
    card = {};
  }
  const brand = card.brand ?? row.brand_key ?? 'External';
  const name = card.name ?? row.name;
  const endpoint = row.a2a_url ?? card.endpoint ?? '';
  return {
    id: row.employee_id,
    name,
    brand,
    brandGradient: card.brandGradient ?? brandGradient(brand),
    logoMark: card.logoMark ?? (name[0] ?? brand[0] ?? 'A').toUpperCase(),
    role: card.roleDefault ?? row.role_slug,
    cardUrl: card.sourceUrl ?? endpoint,
    url: endpoint,
    cardLabel: `${brand} · persisted`,
    connected: row.enabled === 1,
    installedAt: Date.parse(row.created_at) || 0,
  };
}

// ───────────────────────── Query hooks ─────────────────────────

export function useMcpServers() {
  return useQuery<McpServer[]>({
    queryKey: ['settings', 'mcp-servers'],
    queryFn: loadMcpServers,
    placeholderData: [],
    refetchOnMount: 'always',
  });
}

export function useMcpToolGrants(companyId: string | null, employeeId: string | null) {
  return useQuery<McpToolGrant[]>({
    queryKey: ['settings', 'mcp-tool-grants', companyId, employeeId],
    queryFn: () => loadMcpToolGrants(companyId ?? '', employeeId ?? ''),
    enabled: Boolean(companyId && employeeId),
    placeholderData: [],
  });
}

export function useExternalEmployees(companyId: string | null) {
  return useQuery({
    queryKey: ['settings', 'external-employees', companyId],
    queryFn: async () => {
      // No company selected → empty result even in the preview build, so the
      // demo fixture never surfaces as if it were a real company's roster.
      if (!companyId) return [];
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(EXTERNAL_EMPLOYEES_FIXTURE);
      const rows = await repos.employees.findByCompany(companyId);
      return rows.filter((row) => row.is_external === 1).map(externalEmployeeFromRow);
    },
    enabled: companyId !== null,
  });
}
