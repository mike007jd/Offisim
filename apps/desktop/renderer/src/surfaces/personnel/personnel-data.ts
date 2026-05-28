/**
 * Personnel-surface view-models, fixtures, zod form schema, and local query
 * hooks.
 *
 * This file is the data SSOT for the Personnel surface only. Every shape here is
 * a Personnel-local view-model (memory entries, version history / fork
 * provenance / diffs, tool permissions, appearance option palettes, profile
 * form schema). It deliberately does not reach into `src/data/**` — Personnel
 * owns its own contracts until the real Tauri commands are available per capability
 * (see apps/desktop/CLAUDE.md). Async hooks use `resolveAsync` from
 * `@/lib/platform.js` so the query paths are exercised.
 */
import { reposOrNull } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import type { Employee } from '@/data/types.js';
import type {
  AccentVariant,
  BodyType,
  EmployeeAppearance,
  Gender,
  HairStyle,
} from '@/lib/avatar.js';
import { resolveAsync } from '@/lib/platform.js';
import {
  EmployeeVersionService,
  InMemoryEventBus,
  type MemoryEntryRow,
  type EmployeeVersionRow,
} from '@offisim/core/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

// ───────────────────────── Profile form ─────────────────────────

export const COMMUNICATION_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;
export type CommunicationFrequency = (typeof COMMUNICATION_OPTIONS)[number]['value'];

export const RISK_OPTIONS = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'aggressive', label: 'Aggressive' },
] as const;
export type RiskPreference = (typeof RISK_OPTIONS)[number]['value'];

export const DECISION_STYLE_OPTIONS = [
  { value: 'collaborative', label: 'Collaborative' },
  { value: 'directive', label: 'Directive' },
  { value: 'consultative', label: 'Consultative' },
  { value: 'autonomous', label: 'Autonomous' },
] as const;

export const STATUS_OPTIONS = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
] as const;

export const MODEL_MODE_OPTIONS = [
  { value: 'inherit', label: 'Inherit unified setting' },
  { value: 'custom', label: 'Custom model' },
] as const;
export type ModelMode = (typeof MODEL_MODE_OPTIONS)[number]['value'];

export const MODEL_FAMILY_OPTIONS = [
  { value: 'configured', label: 'Configured validation models' },
  { value: 'custom', label: 'Custom' },
] as const;

export const profileFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.string().min(1, 'Role is required'),
  enabled: z.boolean(),
  workstation: z.string(),
  expertise: z.string(),
  workingStyle: z.string(),
  communication: z.enum(['low', 'medium', 'high']),
  risk: z.enum(['conservative', 'balanced', 'aggressive']),
  decisionStyle: z.string().min(1),
  modelMode: z.enum(['inherit', 'custom']),
  modelFamily: z.string(),
  modelOverride: z.string(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1, 'Must be ≥ 1'),
  customInstructions: z.string(),
});
export type ProfileFormValues = z.infer<typeof profileFormSchema>;

/** Seed the profile form from an employee view-model. The renderer view-model is
 *  intentionally thinner than the backend record, so persona fields fall back to
 *  derived defaults until the real employee config command lands. */
export function profileDefaults(employee: Employee): ProfileFormValues {
  return {
    name: employee.name,
    role: employee.role,
    enabled: !employee.disabled,
    workstation: employee.workstationId ?? '',
    expertise: (employee.expertise ?? []).join(', '),
    workingStyle: 'detail-oriented, collaborative',
    communication: 'medium',
    risk: 'balanced',
    decisionStyle: 'collaborative',
    modelMode: 'inherit',
    modelFamily: 'configured',
    modelOverride: '',
    temperature: 0.7,
    maxTokens: 4096,
    customInstructions: '',
  };
}

/** Compose the read-only system-prompt preview from the live form state. */
export function buildSystemPrompt(values: ProfileFormValues, companyName: string): string {
  const lines = [
    `You are ${values.name || 'this employee'}, a ${values.role || 'teammate'} at ${companyName}.`,
    '',
    `Expertise: ${values.expertise || '—'}`,
    `Working style: ${values.workingStyle || '—'}`,
    `Communication frequency: ${values.communication} · Risk preference: ${values.risk}`,
    `Decision style: ${values.decisionStyle}`,
  ];
  if (values.customInstructions.trim()) {
    lines.push('', '## Custom instructions', values.customInstructions.trim());
  }
  lines.push(
    '',
    'Follow company playbooks. Produce reviewable, minimal diffs. Surface risks before',
    'acting on irreversible changes.',
  );
  return lines.join('\n');
}

// ───────────────────────── Tool permissions ─────────────────────────

export const TOOL_DEFAULT_MODE_OPTIONS = [
  { value: 'auto-allow', label: 'Auto-allow' },
  { value: 'ask-each', label: 'Ask each call' },
  { value: 'deny-all', label: 'Deny all' },
] as const;
export type ToolDefaultMode = (typeof TOOL_DEFAULT_MODE_OPTIONS)[number]['value'];

export type ToolPermissionState = 'allow' | 'ask' | 'deny';

export interface BuiltinTool {
  id: string;
  name: string;
  description: string;
  icon: 'read' | 'write' | 'bash' | 'grep' | 'fetch';
}

export const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    id: 'read_file',
    name: 'read_file',
    description: 'Read text/binary file within bound workspace_root',
    icon: 'read',
  },
  {
    id: 'write_file',
    name: 'write_file',
    description: 'Write/replace file content (8 MB cap)',
    icon: 'write',
  },
  {
    id: 'bash',
    name: 'bash',
    description: 'Execute shell command (1 MB stdout cap)',
    icon: 'bash',
  },
  {
    id: 'project_grep',
    name: 'project_grep',
    description: 'Search workspace files by regex/literal',
    icon: 'grep',
  },
  {
    id: 'web_fetch',
    name: 'web_fetch',
    description: 'HTTP fetch · subject to CSP allowlist',
    icon: 'fetch',
  },
];

export interface ToolPermissions {
  defaultMode: ToolDefaultMode;
  overrides: Record<string, ToolPermissionState>;
}

export function defaultToolPermissions(): ToolPermissions {
  return {
    defaultMode: 'ask-each',
    overrides: {
      read_file: 'allow',
      write_file: 'ask',
      bash: 'ask',
      project_grep: 'allow',
      web_fetch: 'deny',
    },
  };
}

// ───────────────────────── Appearance options ─────────────────────────

export interface SwatchOption {
  value: string;
  label: string;
}

/** Curated swatch palettes — SSOT mirrors `src/lib/avatar.ts` palettes
 *  (hash-stripped hex with a leading `#` for swatch rendering). */
export const SKIN_SWATCHES: SwatchOption[] = [
  { value: UI_DATA_COLORS.lightSkin, label: 'Light' },
  { value: UI_DATA_COLORS.fairSkin, label: 'Fair' },
  { value: UI_DATA_COLORS.tanSkin, label: 'Tan' },
  { value: UI_DATA_COLORS.brownSkin, label: 'Brown' },
  { value: UI_DATA_COLORS.deepSkin, label: 'Deep' },
  { value: UI_DATA_COLORS.warmSkin, label: 'Warm' },
];

export const HAIR_SWATCHES: SwatchOption[] = [
  { value: UI_DATA_COLORS.brownBlack, label: 'Black' },
  { value: UI_DATA_COLORS.darkBrown, label: 'Dark brown' },
  { value: UI_DATA_COLORS.midBrown, label: 'Brown' },
  { value: UI_DATA_COLORS.auburn, label: 'Auburn' },
  { value: UI_DATA_COLORS.lightBrown, label: 'Light brown' },
  { value: UI_DATA_COLORS.blonde, label: 'Blonde' },
  { value: UI_DATA_COLORS.greyHair, label: 'Grey' },
];

export const CLOTHING_SWATCHES: SwatchOption[] = [
  { value: UI_DATA_COLORS.blue, label: 'Blue' },
  { value: UI_DATA_COLORS.green, label: 'Green' },
  { value: UI_DATA_COLORS.red3, label: 'Red' },
  { value: UI_DATA_COLORS.amber3, label: 'Amber' },
  { value: UI_DATA_COLORS.violet, label: 'Violet' },
  { value: UI_DATA_COLORS.ink3, label: 'Slate' },
];

export const ACCENT_SWATCHES: SwatchOption[] = [...CLOTHING_SWATCHES];

export const HAIR_STYLE_OPTIONS: ReadonlyArray<{ value: HairStyle; label: string }> = [
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
  { value: 'ponytail', label: 'Ponytail' },
  { value: 'curly', label: 'Curly' },
  { value: 'bald', label: 'Bald' },
  { value: 'bob', label: 'Bob' },
  { value: 'spiky', label: 'Spiky' },
  { value: 'braids', label: 'Braids' },
];

export const BODY_TYPE_OPTIONS: ReadonlyArray<{ value: BodyType; label: string }> = [
  { value: 'slim', label: 'Slim' },
  { value: 'normal', label: 'Normal' },
  { value: 'stocky', label: 'Stocky' },
];

export const GENDER_OPTIONS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'masculine', label: 'Masc' },
  { value: 'feminine', label: 'Fem' },
];

export const ACCENT_VARIANT_OPTIONS: ReadonlyArray<{ value: AccentVariant; label: string }> = [
  { value: 'vest', label: 'Vest' },
  { value: 'jacket', label: 'Jacket' },
  { value: 'scarf', label: 'Scarf' },
];

export type AppearanceDraft = EmployeeAppearance;

export function appearanceDraftFor(employee: Employee): AppearanceDraft {
  return {
    skinColor: employee.appearance?.skinColor,
    hairColor: employee.appearance?.hairColor,
    clothingColor: employee.appearance?.clothingColor ?? employee.avatarA,
    accentColor: employee.appearance?.accentColor ?? employee.avatarB,
    hairStyle: employee.appearance?.hairStyle ?? 'short',
    bodyType: employee.appearance?.bodyType ?? 'normal',
    gender: employee.appearance?.gender ?? 'neutral',
    accentVariant: employee.appearance?.accentVariant ?? 'vest',
  };
}

// ───────────────────────── Memory ─────────────────────────

export const MEMORY_CATEGORIES = ['experience', 'decision', 'knowledge', 'preference'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type MemoryScope = 'employee' | 'company';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  importance: number;
  scope: MemoryScope;
  reinforced: number;
}

const MEMORY_FIXTURE: Record<string, MemoryEntry[]> = {
  'emp-mara': [
    {
      id: 'mem-1',
      category: 'experience',
      content:
        'Shipped the v3 layout overhaul; learned the Tabs retain-state class is required to avoid CLS.',
      importance: 0.8,
      scope: 'employee',
      reinforced: 3,
    },
    {
      id: 'mem-2',
      category: 'experience',
      content: 'Boss prefers one bundled PR over many small ones for refactors in the chat area.',
      importance: 0.6,
      scope: 'company',
      reinforced: 1,
    },
    {
      id: 'mem-3',
      category: 'decision',
      content:
        'Picked Drizzle over Prisma for the local DB layer (small surface, no codegen runtime).',
      importance: 0.5,
      scope: 'company',
      reinforced: 2,
    },
    {
      id: 'mem-4',
      category: 'knowledge',
      content:
        'Deterministic harness is the only allowed automated-proof layer; product validation stays live-agent.',
      importance: 0.7,
      scope: 'company',
      reinforced: 5,
    },
    {
      id: 'mem-5',
      category: 'preference',
      content: 'Replies in Chinese unless the question is English-tagged.',
      importance: 0.4,
      scope: 'employee',
      reinforced: 8,
    },
  ],
};

export function useEmployeeMemories(employeeId: string | null) {
  return useQuery({
    queryKey: ['personnel', 'memories', employeeId],
    queryFn: async () => {
      if (!employeeId) return [];
      const repos = await reposOrNull();
      if (!repos) return resolveAsync<MemoryEntry[]>(MEMORY_FIXTURE[employeeId] ?? []);
      const rows = await repos.memories.findByOwner(employeeId, { limit: 50 });
      return rows.filter((row) => row.scope === 'employee').map(memoryEntryFromRow);
    },
    enabled: employeeId !== null,
  });
}

function memoryEntryFromRow(row: MemoryEntryRow): MemoryEntry {
  return {
    id: row.memory_id,
    category: row.category,
    content: row.content,
    importance: row.importance,
    scope: row.scope === 'employee' ? 'employee' : 'company',
    reinforced: row.reinforcement_count,
  };
}

export function useCreateEmployeeMemory(employeeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      category,
      content,
      importance,
    }: {
      category: MemoryCategory;
      content: string;
      importance: number;
    }) => {
      if (!employeeId) throw new Error('Select an employee before creating memory');
      const repos = await reposOrNull();
      if (!repos) throw new Error('Memory editing requires the desktop runtime');
      const employee = await repos.employees.findById(employeeId);
      if (!employee) throw new Error(`Employee not found: ${employeeId}`);
      await repos.memories.create({
        memory_id: `mem-${crypto.randomUUID()}`,
        company_id: employee.company_id,
        scope: 'employee',
        owner_id: employeeId,
        category,
        content,
        importance,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'memories', employeeId] });
    },
  });
}

export function useUpdateEmployeeMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      employeeId,
      memoryId,
      content,
      importance,
    }: {
      employeeId: string;
      memoryId: string;
      content?: string;
      importance?: number;
    }) => {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Memory editing requires the desktop runtime');
      await repos.memories.update(memoryId, { content, importance });
      return employeeId;
    },
    onSuccess: (employeeId) => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'memories', employeeId] });
    },
  });
}

export function useDeleteEmployeeMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, memoryId }: { employeeId: string; memoryId: string }) => {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Memory editing requires the desktop runtime');
      await repos.memories.delete(memoryId);
      return employeeId;
    },
    onSuccess: (employeeId) => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'memories', employeeId] });
    },
  });
}

// ───────────────────────── Version history ─────────────────────────

export type VersionChangeType = 'created' | 'updated' | 'rollback';

export interface EmployeeVersion {
  id: string;
  /** Sequential version number, 1-based. */
  version: number;
  changeType: VersionChangeType;
  summary: string;
  timestamp: string;
  current: boolean;
}

export type DiffKind = 'add' | 'remove' | 'change';

export interface VersionDiffRow {
  field: string;
  kind: DiffKind;
  previous: string;
  current: string;
}

export interface ForkProvenance {
  sourceAssetId: string;
  packageId?: string;
  marketplaceUrl?: string;
}

export interface EmployeeHistory {
  fork: ForkProvenance | null;
  versions: EmployeeVersion[];
  /** Diff rows keyed by the selected version number (vN → current). */
  diffs: Record<number, VersionDiffRow[]>;
}

const HISTORY_FIXTURE: Record<string, EmployeeHistory> = {
  'emp-mara': {
    fork: {
      sourceAssetId: 'asset_frontend_eng_v2',
      packageId: 'pkg_studio_bundle',
      marketplaceUrl: 'https://market.offisim.dev/listing/asset_frontend_eng_v2',
    },
    versions: [
      {
        id: 'v5',
        version: 5,
        changeType: 'updated',
        summary: 'Tighten persona; bump max tokens',
        timestamp: '2026-05-04 14:22',
        current: true,
      },
      {
        id: 'v4',
        version: 4,
        changeType: 'updated',
        summary: 'Switch model mode to custom',
        timestamp: '2026-05-01 09:18',
        current: false,
      },
      {
        id: 'v3',
        version: 3,
        changeType: 'rollback',
        summary: 'Rolled back to v1 persona',
        timestamp: '2026-04-22 17:03',
        current: false,
      },
      {
        id: 'v2',
        version: 2,
        changeType: 'updated',
        summary: 'Add accessibility expertise',
        timestamp: '2026-04-12 11:40',
        current: false,
      },
      {
        id: 'v1',
        version: 1,
        changeType: 'created',
        summary: '2026-04-02 10:14',
        timestamp: '2026-04-02 10:14',
        current: false,
      },
    ],
    diffs: {
      3: [
        {
          field: 'workingStyle',
          kind: 'change',
          previous: 'collaborative',
          current: 'detail-oriented, collaborative',
        },
        { field: 'maxTokens', kind: 'change', previous: '4096', current: '8192' },
        { field: 'modelPreference', kind: 'add', previous: '(empty)', current: 'Runtime default' },
        {
          field: 'legacyHint',
          kind: 'remove',
          previous: '"force collaborative tone"',
          current: '(removed)',
        },
      ],
      4: [{ field: 'maxTokens', kind: 'change', previous: '4096', current: '8192' }],
      2: [
        {
          field: 'expertise',
          kind: 'add',
          previous: '(empty)',
          current: 'accessibility',
        },
      ],
    },
  },
};

function formatVersionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function summarizeSnapshotValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function diffSnapshots(selectedSnapshot: string, currentSnapshot: string): VersionDiffRow[] {
  const selected = JSON.parse(selectedSnapshot) as Record<string, unknown>;
  const current = JSON.parse(currentSnapshot) as Record<string, unknown>;
  const keys = new Set([...Object.keys(selected), ...Object.keys(current)]);
  return [...keys]
    .filter(
      (key) => summarizeSnapshotValue(selected[key]) !== summarizeSnapshotValue(current[key]),
    )
    .map((key) => ({
      field: key,
      kind:
        selected[key] == null ? 'add' : current[key] == null ? 'remove' : ('change' as DiffKind),
      previous: summarizeSnapshotValue(selected[key]),
      current: summarizeSnapshotValue(current[key]),
    }));
}

function rowChangeType(row: EmployeeVersionRow): VersionChangeType {
  if (row.change_type === 'create') return 'created';
  if (row.change_type === 'update') return 'updated';
  return row.change_type;
}

function employeeHistoryFromRows(rows: EmployeeVersionRow[]): EmployeeHistory | null {
  if (rows.length === 0) return null;
  const currentRow = rows.reduce((latest, row) =>
    row.version_num > latest.version_num ? row : latest,
  );
  return {
    fork: null,
    versions: rows.map((row) => ({
      id: row.version_id,
      version: row.version_num,
      changeType: rowChangeType(row),
      summary: row.change_summary ?? `${rowChangeType(row)} employee version`,
      timestamp: formatVersionTimestamp(row.created_at),
      current: row.version_id === currentRow.version_id,
    })),
    diffs: Object.fromEntries(
      rows
        .filter((row) => row.version_id !== currentRow.version_id)
        .map((row) => [
          row.version_num,
          diffSnapshots(row.snapshot_json, currentRow.snapshot_json),
        ]),
    ),
  };
}

export function useEmployeeVersions(employeeId: string | null) {
  return useQuery({
    queryKey: ['personnel', 'versions', employeeId],
    queryFn: async () => {
      if (!employeeId) return null;
      const repos = await reposOrNull();
      if (!repos) return resolveAsync<EmployeeHistory | null>(HISTORY_FIXTURE[employeeId] ?? null);
      const rows = await repos.employeeVersions.findByEmployee(employeeId, { limit: 24 });
      return employeeHistoryFromRows(rows);
    },
    enabled: employeeId !== null,
  });
}

export function useRollbackEmployeeVersion(employeeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (version: number) => {
      if (!employeeId) throw new Error('Select an employee before rollback');
      const repos = await reposOrNull();
      if (!repos) throw new Error('Version rollback requires the desktop runtime');
      const versionService = new EmployeeVersionService(
        repos.employeeVersions,
        repos.employees,
        new InMemoryEventBus(),
      );
      await versionService.rollbackToVersion(employeeId, version);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'versions', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}
