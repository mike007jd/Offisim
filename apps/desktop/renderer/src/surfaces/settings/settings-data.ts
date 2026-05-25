/**
 * Settings-surface view-models, fixtures, and local query hooks.
 *
 * This file is the data SSOT for the Settings surface only. Every shape here is a
 * Settings-local view-model (provider configs, runtime defaults, MCP servers,
 * external employees, vault status). It deliberately does not reach into
 * `src/data/**` — Settings owns its own contracts until the real Tauri commands
 * are wired per-capability (see apps/desktop/CLAUDE.md). Async hooks use
 * `resolveAsync` from `@/lib/platform.js` so the query paths are exercised.
 */
import { resolveAsync } from '@/lib/platform.js';
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
  { value: 'minimax-global', label: 'MiniMax Global (default)' },
  { value: 'minimax-cn', label: 'MiniMax CN' },
] as const;

export const EXECUTION_LANE_OPTIONS = [
  { value: 'gateway', label: 'Gateway' },
  { value: 'claude-agent-sdk', label: 'Claude Agent SDK (transport only)' },
  { value: 'codex-agent-sdk', label: 'Codex Agent SDK (transport only)' },
  { value: 'openai-agents-sdk', label: 'OpenAI Agents SDK (transport only)' },
] as const;

export const MODEL_SUGGESTIONS = [
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'gpt-4o-mini',
  'anthropic/claude-sonnet',
  'gemini-2.5-flash',
] as const;

export const PROVIDER_CONFIGS: readonly [ProviderConfig, ...ProviderConfig[]] = [
  {
    id: 'minimax-global',
    product: 'minimax',
    displayName: 'MiniMax Global',
    logoMark: 'M',
    logoGradient: ['#2f6bff', '#6b4dff'],
    model: 'MiniMax-M2.7',
    subtitle: 'MiniMax-M2.7 · default',
    health: 'active',
    accessMode: 'global-key',
    lane: 'gateway',
    region: 'global',
    endpointKind: 'chat/completions',
    credentialDestination: 'https://api.minimax.io',
    hasStoredKey: true,
    isThinking: true,
    hostResolved: false,
  },
  {
    id: 'openai-backup',
    product: 'openai',
    displayName: 'OpenAI',
    logoMark: 'O',
    logoGradient: ['#1aa46a', '#15824f'],
    model: 'gpt-4o-mini',
    subtitle: 'gpt-4o-mini · backup',
    health: 'stale',
    accessMode: 'global-key',
    lane: 'gateway',
    region: 'global',
    endpointKind: 'chat/completions',
    credentialDestination: 'https://api.openai.com',
    hasStoredKey: true,
    isThinking: false,
    hostResolved: false,
  },
  {
    id: 'openrouter',
    product: 'openrouter',
    displayName: 'OpenRouter',
    logoMark: 'R',
    logoGradient: ['#c98410', '#8a5a0c'],
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
    logoGradient: ['#7c4ddb', '#4d6bff'],
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
    logoGradient: ['#d6453d', '#b8352e'],
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
    logoGradient: ['#647186', '#3c4a60'],
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

export interface CatalogState {
  readonly lastSuccess: string;
  readonly scopeSummary: string;
  readonly freshCount: number;
  readonly sources: ReadonlyArray<{ label: string; summary: string }>;
  readonly error?: string;
}

export const CATALOG_STATE: CatalogState = {
  lastSuccess: '2026-05-15 18:40',
  scopeSummary: 'Hermes Agent / OpenClaw scope, LiteLLM + OpenRouter model metadata',
  freshCount: 42,
  sources: [
    { label: 'Hermes Agent', summary: '12 providers / 42 models' },
    { label: 'OpenClaw', summary: '8 providers / 31 models' },
  ],
  error: 'Last refresh failed: network unreachable',
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
    variant: 'minimax-global',
    lane: config.lane,
    endpointOverride: '',
    headersJson: '',
  };
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
  { value: 'claude', label: 'Claude engine' },
  { value: 'codex', label: 'Codex engine' },
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
  { value: 'claude', label: 'Claude engine' },
  { value: 'codex', label: 'Codex engine' },
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
  replacementMode: 'Unavailable until release evidence',
  profiles: [
    { name: 'claude-agent-sdk:driver', verified: true, note: 'Verified' },
    { name: 'codex-agent-sdk:replacement', verified: false, note: 'No release evidence' },
  ],
};

export interface SceneDiagnosticState {
  readonly lastExport: string;
  readonly lastFileName: string;
}

export const SCENE_DIAGNOSTIC: SceneDiagnosticState = {
  lastExport: '2026-05-20 14:32',
  lastFileName: 'scene-drop-diagnostic-1747752720.json',
};

export interface VaultStatus {
  readonly path: string;
  readonly employees: number;
  readonly files: number;
  readonly size: string;
}

export const VAULT_STATUS: VaultStatus = {
  path: '~/Library/Application Support/com.offisim.desktop/vault',
  employees: 12,
  files: 184,
  size: '8.4 MB',
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
export type McpStatus = 'connected' | 'disconnected' | 'connecting';
export type McpSource = 'user-config' | 'workspace' | 'defaults';

export interface McpServer {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransport;
  readonly status: McpStatus;
  readonly source: McpSource;
  readonly command: string;
  readonly approvalId: string;
  readonly requestedTools: readonly string[];
  readonly riskyTools: readonly string[];
}

export const MCP_SERVERS_FIXTURE: readonly McpServer[] = [
  {
    id: 'serena',
    name: 'serena',
    transport: 'stdio',
    status: 'connected',
    source: 'user-config',
    command: 'uvx --from serena serena-mcp-server --context ide-assistant',
    approvalId: 'mcp.serena.ide-assistant',
    requestedTools: [
      'find_symbol',
      'find_referencing_symbols',
      'get_symbols_overview',
      'insert_after_symbol',
      'replace_symbol_body',
      'execute_shell_command',
    ],
    riskyTools: ['execute_shell_command'],
  },
  {
    id: 'gitnexus',
    name: 'gitnexus',
    transport: 'stdio',
    status: 'disconnected',
    source: 'user-config',
    command: 'npx -y gitnexus mcp --repo .',
    approvalId: 'mcp.gitnexus.default',
    requestedTools: ['query', 'impact', 'route_map'],
    riskyTools: [],
  },
  {
    id: 'context7',
    name: 'context7',
    transport: 'sse',
    status: 'connecting',
    source: 'workspace',
    command: 'https://mcp.context7.com/sse',
    approvalId: 'mcp.context7.workspace',
    requestedTools: ['query-docs', 'resolve-library-id'],
    riskyTools: [],
  },
];

export const MCP_STATUS_LABELS: Record<McpStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
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

// ───────────────────────── External Employees ─────────────────────────

export interface ExternalEmployee {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly brandGradient: readonly [string, string];
  readonly logoMark: string;
  readonly role: string;
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
    brandGradient: ['#ff6b35', '#ff3d81'],
    logoMark: 'O',
    role: 'research-analyst',
    url: 'https://agent.openclaw.ai/a2a',
    cardLabel: 'OpenClaw Research · v2.4.1',
    connected: true,
    installedAt: 3,
  },
  {
    id: 'hermes',
    name: 'Hermes Ops',
    brand: 'Hermes',
    brandGradient: ['#7c4ddb', '#4d6bff'],
    logoMark: 'H',
    role: 'ops-runner',
    url: 'https://hermes.run/v1/a2a',
    cardLabel: 'Hermes · v1.9.0',
    connected: true,
    installedAt: 2,
  },
  {
    id: 'codex',
    name: 'Codex Worker',
    brand: 'Codex',
    brandGradient: ['#1aa46a', '#15824f'],
    logoMark: 'C',
    role: 'code-writer',
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
  readonly endpoint: string;
}

/** Stub discovery — mimics fetching a `.well-known/agent.json` card. */
export async function discoverAgentCard(url: string): Promise<DiscoveredCard> {
  const normalized = url.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error('Could not reach agent card · check URL');
  }
  return resolveAsync<DiscoveredCard>({
    name: 'Otto Reeves',
    description: 'Research analyst that synthesizes web sources into citation-ranked briefs.',
    brand: normalized.includes('openclaw') ? 'OpenClaw' : 'custom',
    brandGradient: ['#ff6b35', '#ff3d81'],
    logoMark: 'O',
    interfaces: 'a2a/jsonrpc · streaming · cancel',
    roleDefault: 'research-analyst',
    endpoint: url.replace(/\/\.well-known\/agent\.json$/, '/a2a'),
  });
}

// ───────────────────────── Query hooks ─────────────────────────

export function useProviderConfigs() {
  return useQuery({
    queryKey: ['settings', 'provider-configs'],
    queryFn: () => resolveAsync(PROVIDER_CONFIGS),
    initialData: PROVIDER_CONFIGS,
  });
}

export function useMcpServers() {
  return useQuery({
    queryKey: ['settings', 'mcp-servers'],
    queryFn: () => resolveAsync(MCP_SERVERS_FIXTURE),
    initialData: MCP_SERVERS_FIXTURE,
  });
}

export function useExternalEmployees() {
  return useQuery({
    queryKey: ['settings', 'external-employees'],
    queryFn: () => resolveAsync(EXTERNAL_EMPLOYEES_FIXTURE),
    initialData: EXTERNAL_EMPLOYEES_FIXTURE,
  });
}
