import { isTauriRuntime, reposOrNull } from '@/data/adapters.js';
/**
 * Settings-surface view-models, fixtures, and local query hooks.
 *
 * This file is the data SSOT for the Settings surface only. Every shape here is a
 * Settings-local view-model (provider configs, runtime defaults, MCP servers,
 * external employees, vault status). It deliberately does not reach into
 * `src/data/**` for visual contracts. External employees are the exception:
 * release builds read the real employee repository because A2A peers are part
 * of the company roster.
 */
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { resolveAsync } from '@/lib/platform.js';
import {
  type RuntimeProviderProfile,
  isDesktopProviderBridgeAvailable,
  loadRuntimeProviderProfiles,
} from '@/lib/provider-bridge.js';
import type { EmployeeRow } from '@offisim/core/browser';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

// ───────────────────────── Provider ─────────────────────────

export type ProviderHealth = 'active' | 'reachable' | 'stale' | 'unused' | 'no-key';

export interface ProviderConfig {
  readonly id: string;
  readonly product: string;
  readonly displayName: string;
  readonly logoMark: string;
  readonly logoGradient: readonly [string, string];
  readonly model: string;
  readonly subtitle: string;
  readonly health: ProviderHealth;
  readonly accessMode: string;
  readonly lane: string;
  readonly region: string;
  readonly endpointKind: string;
  readonly credentialDestination: string;
  readonly hasStoredKey: boolean;
  readonly isThinking: boolean;
  readonly hostResolved: boolean;
}

export const PRODUCT_OPTIONS = [
  { value: 'minimax', label: 'MiniMax' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'ollama', label: 'Ollama' },
] as const;

export const ACCESS_MODE_OPTIONS = [
  { value: 'global-key', label: 'Global API key' },
  { value: 'host-resolved', label: 'Host-resolved' },
  { value: 'managed', label: 'Managed by host' },
] as const;

export const PROVIDER_VARIANT_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'minimax-global', label: 'MiniMax Global (default)' },
  { value: 'minimax-cn', label: 'MiniMax CN' },
] as const;

export const EXECUTION_LANE_OPTIONS = [
  { value: 'gateway', label: 'Gateway' },
  { value: 'claude-agent-sdk', label: 'Claude Agent SDK (transport only)' },
  { value: 'codex-agent-sdk', label: 'Codex Agent SDK (transport only)' },
  { value: 'openai-agents-sdk', label: 'OpenAI Agents SDK (transport only)' },
] as const;

export const PROVIDER_CONFIGS: readonly [ProviderConfig, ...ProviderConfig[]] = [
  {
    id: 'minimax',
    product: 'minimax',
    displayName: 'MiniMax Global',
    logoMark: 'M',
    logoGradient: [UI_DATA_COLORS.blue, UI_DATA_COLORS.blueViolet],
    model: 'MiniMax-M2.7',
    subtitle: 'MiniMax-M2.7 · default',
    health: 'no-key',
    accessMode: 'global-key',
    lane: 'gateway',
    region: 'global',
    endpointKind: 'messages',
    credentialDestination: 'https://api.minimax.io/anthropic',
    hasStoredKey: false,
    isThinking: true,
    hostResolved: false,
  },
  {
    id: 'openai-backup',
    product: 'openai',
    displayName: 'OpenAI',
    logoMark: 'O',
    logoGradient: [UI_DATA_COLORS.green, UI_DATA_COLORS.green2],
    model: 'gpt-4o-mini',
    subtitle: 'gpt-4o-mini · backup',
    health: 'stale',
    accessMode: 'global-key',
    lane: 'gateway',
    region: 'global',
    endpointKind: 'chat/completions',
    credentialDestination: 'https://api.openai.com',
    hasStoredKey: false,
    isThinking: false,
    hostResolved: false,
  },
  {
    id: 'openrouter',
    product: 'openrouter',
    displayName: 'OpenRouter',
    logoMark: 'R',
    logoGradient: [UI_DATA_COLORS.amber3, UI_DATA_COLORS.amber4],
    model: 'anthropic/claude-sonnet',
    subtitle: 'anthropic/claude-sonnet',
    health: 'unused',
    accessMode: 'global-key',
    lane: 'gateway',
    region: 'global',
    endpointKind: 'chat/completions',
    credentialDestination: 'https://openrouter.ai',
    hasStoredKey: false,
    isThinking: false,
    hostResolved: false,
  },
  {
    id: 'anthropic',
    product: 'anthropic',
    displayName: 'Anthropic',
    logoMark: 'A',
    logoGradient: [UI_DATA_COLORS.violet, UI_DATA_COLORS.blue3],
    model: 'claude-opus-4',
    subtitle: 'claude-opus-4 · direct',
    health: 'no-key',
    accessMode: 'global-key',
    lane: 'gateway',
    region: 'global',
    endpointKind: 'messages',
    credentialDestination: 'https://api.anthropic.com',
    hasStoredKey: false,
    isThinking: false,
    hostResolved: false,
  },
  {
    id: 'google',
    product: 'google',
    displayName: 'Google',
    logoMark: 'G',
    logoGradient: [UI_DATA_COLORS.red3, UI_DATA_COLORS.red5],
    model: 'gemini-2.5-flash',
    subtitle: 'gemini-2.5-flash',
    health: 'no-key',
    accessMode: 'global-key',
    lane: 'gateway',
    region: 'global',
    endpointKind: 'generateContent',
    credentialDestination: 'https://generativelanguage.googleapis.com',
    hasStoredKey: false,
    isThinking: false,
    hostResolved: false,
  },
  {
    id: 'ollama-local',
    product: 'ollama',
    displayName: 'Ollama',
    logoMark: 'L',
    logoGradient: [UI_DATA_COLORS.ink6, UI_DATA_COLORS.ink3],
    model: 'qwen2.5:14b',
    subtitle: 'qwen2.5:14b · local',
    health: 'reachable',
    accessMode: 'host-resolved',
    lane: 'gateway',
    region: 'local',
    endpointKind: 'chat',
    credentialDestination: 'http://localhost:11434',
    hasStoredKey: false,
    isThinking: false,
    hostResolved: true,
  },
];

export const PROVIDER_HEALTH_LABELS: Record<ProviderHealth, string> = {
  active: 'Active',
  reachable: 'Reachable',
  stale: 'Stale key',
  unused: 'Unused',
  'no-key': 'No key',
};

export const providerFormSchema = z.object({
  configId: z.string().min(1),
  product: z.string().min(1, 'Required'),
  accessMode: z.string().min(1, 'Required'),
  model: z.string().min(1, 'Model is required'),
  apiKey: z.string(),
  variant: z.string().min(1),
  lane: z.string().min(1),
  endpointOverride: z.string(),
  headersJson: z.string(),
});
export type ProviderFormValues = z.infer<typeof providerFormSchema>;

export function providerDefaults(config: ProviderConfig): ProviderFormValues {
  return {
    configId: config.id,
    product: config.product,
    accessMode: config.accessMode,
    model: config.model,
    apiKey: '',
    variant: config.product === 'minimax' ? 'minimax-global' : 'standard',
    lane: config.lane,
    endpointOverride: '',
    headersJson: '',
  };
}

function endpointKindForRuntimeProfile(profile: RuntimeProviderProfile): string {
  return profile.provider === 'anthropic' ? 'messages' : 'chat/completions';
}

function productForRuntimeProfile(profile: RuntimeProviderProfile): string {
  const name = `${profile.id} ${profile.displayName}`.toLowerCase();
  if (name.includes('minimax')) return 'minimax';
  if (name.includes('openrouter')) return 'openrouter';
  if (profile.provider === 'openai') return 'openai';
  if (profile.provider === 'anthropic') return 'anthropic';
  return 'openai-compatible';
}

function logoMarkForRuntimeProfile(profile: RuntimeProviderProfile): string {
  return (profile.displayName.trim()[0] ?? profile.id.trim()[0] ?? 'P').toUpperCase();
}

function baseConfigForRuntimeProfile(
  baseConfigs: readonly ProviderConfig[],
  profile: RuntimeProviderProfile,
): ProviderConfig {
  const product = productForRuntimeProfile(profile);
  const fallbackBase = baseConfigs[0] ?? PROVIDER_CONFIGS[0];
  const base =
    baseConfigs.find((candidate) => candidate.id === profile.id) ??
    baseConfigs.find((candidate) => candidate.product === product) ??
    fallbackBase;
  return {
    ...base,
    id: profile.id,
    product,
    displayName: profile.displayName || profile.id,
    logoMark: logoMarkForRuntimeProfile(profile),
    subtitle: `${profile.model} · runtime`,
    region: profile.localEndpoint ? 'local' : 'custom',
    credentialDestination: profile.baseUrl || base.credentialDestination,
    isThinking: product === 'minimax' || base.isThinking,
  };
}

function providerConfigFromRuntime(
  base: ProviderConfig,
  profile: RuntimeProviderProfile,
): ProviderConfig {
  const health: ProviderHealth = profile.hasCredential
    ? profile.localEndpoint
      ? 'reachable'
      : 'active'
    : 'no-key';
  return {
    ...base,
    displayName: profile.displayName || base.displayName,
    model: profile.model || base.model,
    subtitle: `${profile.model || base.model} · runtime`,
    health,
    accessMode: profile.localEndpoint ? 'host-resolved' : base.accessMode,
    endpointKind: endpointKindForRuntimeProfile(profile),
    credentialDestination: profile.baseUrl || base.credentialDestination,
    hasStoredKey: profile.hasCredential,
    hostResolved: profile.localEndpoint,
  };
}

function mergeRuntimeProviderConfigs(
  baseConfigs: readonly ProviderConfig[],
  runtimeProfiles: readonly RuntimeProviderProfile[],
): ProviderConfig[] {
  const merged = baseConfigs.map((base) => {
    const profile =
      runtimeProfiles.find((candidate) => candidate.id === base.id) ??
      runtimeProfiles.find(
        (candidate) =>
          base.product === 'minimax' && candidate.displayName.toLowerCase().includes('minimax'),
      );
    return profile ? providerConfigFromRuntime(base, profile) : base;
  });
  const seen = new Set(merged.map((config) => config.id));
  for (const profile of runtimeProfiles) {
    if (seen.has(profile.id)) continue;
    merged.push(
      providerConfigFromRuntime(baseConfigForRuntimeProfile(baseConfigs, profile), profile),
    );
    seen.add(profile.id);
  }
  return merged;
}

/**
 * Resolve the active provider config from the merged runtime list by id. SSOT
 * for "which config the UI shows and saves" — the displayed pane and the save
 * path must both resolve through this so the persisted endpoint always matches
 * the runtime-profile-merged config on screen, not a static base.
 */
export function resolveActiveProviderConfig(
  configs: readonly ProviderConfig[],
  activeConfigId: string,
): ProviderConfig {
  return (
    configs.find((config) => config.id === activeConfigId) ?? configs[0] ?? PROVIDER_CONFIGS[0]
  );
}

// ───────────────────────── Runtime ─────────────────────────

export const EXECUTION_MODE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'manual', label: 'Manual' },
  { value: 'review', label: 'Review every step' },
] as const;

export const ENABLED_OPTIONS = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
] as const;

export const DEFAULT_RUNTIME_OPTIONS = [
  { value: 'gateway', label: 'Offisim core (gateway)' },
  { value: 'claude', label: 'Verified driver' },
  { value: 'codex', label: 'Isolated driver' },
] as const;

export const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;
export type ThemeValue = (typeof THEME_OPTIONS)[number]['value'];

export const DENSITY_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'spacious', label: 'Spacious' },
] as const;
export type DensityValue = (typeof DENSITY_OPTIONS)[number]['value'];

export const RUNTIME_BINDING_OPTIONS = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'gateway', label: 'Provider gateway' },
  { value: 'claude', label: 'Verified driver' },
  { value: 'codex', label: 'Isolated driver' },
] as const;
export type RuntimeBindingValue = (typeof RUNTIME_BINDING_OPTIONS)[number]['value'];

export interface HarnessControl {
  readonly defaultOwner: string;
  readonly verifiedProfiles: number;
  readonly replacementMode: string;
  readonly profiles: ReadonlyArray<{ name: string; verified: boolean; note: string }>;
}

export const HARNESS_CONTROL: HarnessControl = {
  defaultOwner: 'Offisim core',
  verifiedProfiles: 1,
  replacementMode: 'Needs release proof',
  profiles: [
    { name: 'gateway-driver', verified: true, note: 'Verified' },
    { name: 'full-agent-driver', verified: false, note: 'Needs proof' },
  ],
};

export const runtimeFormSchema = z.object({
  executionMode: z.string().min(1),
  toolSearch: z.string().min(1),
  gitAutoCommit: z.string().min(1),
  defaultRuntime: z.string().min(1),
  runtimeBinding: z.string().min(1),
  memoryEnabled: z.string().min(1),
  memoryInjection: z.string().min(1),
  memoryMaxFacts: z.number().int().min(0, 'Must be ≥ 0'),
  memoryConfidence: z.number().min(0).max(1, 'Between 0 and 1'),
  summarizationEnabled: z.string().min(1),
  summarizationTrigger: z.number().int().min(0, 'Must be ≥ 0'),
  summarizationKeepRecent: z.number().int().min(0, 'Must be ≥ 0'),
});
export type RuntimeFormValues = z.infer<typeof runtimeFormSchema>;

export const RUNTIME_DEFAULTS: RuntimeFormValues = {
  executionMode: 'auto',
  toolSearch: 'enabled',
  gitAutoCommit: 'enabled',
  defaultRuntime: 'gateway',
  runtimeBinding: 'gateway',
  memoryEnabled: 'enabled',
  memoryInjection: 'enabled',
  memoryMaxFacts: 200,
  memoryConfidence: 0.6,
  summarizationEnabled: 'enabled',
  summarizationTrigger: 48000,
  summarizationKeepRecent: 12,
};

// ───────────────────────── MCP ─────────────────────────

export type McpTransport = 'stdio' | 'sse';
export type McpStatus = 'connected' | 'disconnected' | 'connecting' | 'registered';
export type McpSource =
  | 'user-config'
  | 'workspace'
  | 'defaults'
  | 'installed-asset'
  | 'developer-runtime';

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
}

interface McpSpawnResult {
  serverName: string;
  state: string;
  tools: Array<{ name: string }>;
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
  return {
    id: server.serverId,
    name: server.name,
    transport: server.transport,
    status: mcpStatusFromRuntime(server, statuses),
    source: normalizeMcpSource(server.source),
    command: mcpDisplayCommand(server),
    approvalId: server.approvalId ?? '',
    commandFingerprint: server.commandFingerprint ?? undefined,
    toolCount: runtime?.toolCount,
    requestedTools: server.requestedTools ?? [],
    riskyTools: server.riskClass === 'high' ? (server.requestedTools ?? []) : [],
  };
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

export async function loadMcpServers(): Promise<McpServer[]> {
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
    throw new Error('SSE MCP servers are registered here and connect from the web runtime.');
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

export const EXTERNAL_EMPLOYEES_FIXTURE: readonly ExternalEmployee[] = [
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

  const response = await fetch(parsed.href, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Agent card returned HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_AGENT_CARD_BYTES) {
    throw new Error('Agent card is too large');
  }

  const text = await response.text();
  if (new Blob([text]).size > MAX_AGENT_CARD_BYTES) {
    throw new Error('Agent card is too large');
  }

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

export function useProviderConfigs() {
  return useQuery<ProviderConfig[]>({
    queryKey: ['settings', 'provider-configs'],
    queryFn: async () => {
      if (!isDesktopProviderBridgeAvailable()) {
        return mergeRuntimeProviderConfigs(PROVIDER_CONFIGS, []);
      }
      const profiles = await loadRuntimeProviderProfiles();
      return mergeRuntimeProviderConfigs(PROVIDER_CONFIGS, profiles);
    },
    placeholderData: [...PROVIDER_CONFIGS],
    refetchOnMount: 'always',
    retry: 2,
  });
}

export function useMcpServers() {
  return useQuery<McpServer[]>({
    queryKey: ['settings', 'mcp-servers'],
    queryFn: loadMcpServers,
    placeholderData: [],
    refetchOnMount: 'always',
  });
}

export function useExternalEmployees(companyId: string | null) {
  return useQuery({
    queryKey: ['settings', 'external-employees', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(EXTERNAL_EMPLOYEES_FIXTURE);
      if (!companyId) return [];
      const rows = await repos.employees.findByCompany(companyId);
      return rows.filter((row) => row.is_external === 1).map(externalEmployeeFromRow);
    },
  });
}
