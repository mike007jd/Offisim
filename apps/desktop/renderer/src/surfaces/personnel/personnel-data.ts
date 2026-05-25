/**
 * Personnel-surface view-models, fixtures, zod form schema, and local query
 * hooks.
 *
 * This file is the data SSOT for the Personnel surface only. Every shape here is
 * a Personnel-local view-model (memory entries, version history / fork
 * provenance / diffs, tool permissions, appearance option palettes, profile
 * form schema). It deliberately does not reach into `src/data/**` — Personnel
 * owns its own contracts until the real Tauri commands are wired per-capability
 * (see apps/desktop/CLAUDE.md). Async hooks use `resolveAsync` from
 * `@/lib/platform.js` so the query paths are exercised.
 */
import type { Employee } from '@/data/types.js';
import type {
  AccentVariant,
  BodyType,
  EmployeeAppearance,
  Gender,
  HairStyle,
} from '@/lib/avatar.js';
import { resolveAsync } from '@/lib/platform.js';
import { useQuery } from '@tanstack/react-query';
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

/** Production build only surfaces validated families + the custom escape hatch.
 *  Suggestion chips / datalist come from the live provider catalog. */
export const MODEL_SUGGESTION_CHIPS = [
  'MiniMax-M2.7',
  'GLM-5.1',
  'openai/gpt-oss-120b:free',
] as const;

/** Office zones offered as workstation assignment targets, with the roles each
 *  zone accepts (drives drag-drop validity). */
export interface WorkstationZone {
  id: string;
  label: string;
  /** Roles this zone accepts; empty = any role. */
  targetRoles: string[];
  desks: Array<{ id: string; label: string; occupiedBy?: string }>;
}

export const WORKSTATION_ZONES: WorkstationZone[] = [
  {
    id: 'engineering_bay',
    label: 'Engineering Bay',
    targetRoles: ['Engineering Lead', 'Frontend Dev', 'Backend Dev', 'QA Analyst', 'DevOps'],
    desks: [
      { id: 'eng-1', label: 'Desk 1', occupiedBy: 'Mara Quinn' },
      { id: 'eng-2', label: 'Desk 2' },
      { id: 'eng-3', label: 'Desk 3' },
      { id: 'eng-4', label: 'Desk 4' },
      { id: 'eng-5', label: 'Desk 5', occupiedBy: 'Sela Ortiz' },
      { id: 'eng-6', label: 'Desk 6' },
    ],
  },
  {
    id: 'design_studio',
    label: 'Design Studio',
    targetRoles: ['Product Designer', 'UI Designer'],
    desks: [
      { id: 'design-1', label: 'Easel 1' },
      { id: 'design-2', label: 'Easel 2', occupiedBy: 'Devin Park' },
      { id: 'design-3', label: 'Easel 3' },
    ],
  },
  {
    id: 'research_lab',
    label: 'Research Lab',
    targetRoles: [],
    desks: [
      { id: 'res-1', label: 'Bench 1' },
      { id: 'res-2', label: 'Bench 2' },
    ],
  },
];

export const WORKSTATION_OPTIONS = [
  { value: '', label: 'Unassigned' },
  ...WORKSTATION_ZONES.flatMap((zone) =>
    zone.desks.map((desk) => ({
      value: `${zone.id}:${desk.id}`,
      label: `${zone.label} · ${desk.label}`,
    })),
  ),
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
    workstation:
      employee.zoneLabel && employee.deskLabel
        ? `${zoneIdFromLabel(employee.zoneLabel)}:${employee.deskLabel}`
        : '',
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

function zoneIdFromLabel(label: string): string {
  return WORKSTATION_ZONES.find((z) => z.label === label)?.id ?? label;
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
    'Follow company SOPs. Produce reviewable, minimal diffs. Surface risks before',
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
  { value: '#f8d9c4', label: 'Light' },
  { value: '#edb98a', label: 'Fair' },
  { value: '#d08b5b', label: 'Tan' },
  { value: '#ae5d29', label: 'Brown' },
  { value: '#614335', label: 'Deep' },
  { value: '#fd9841', label: 'Warm' },
];

export const HAIR_SWATCHES: SwatchOption[] = [
  { value: '#2c1b18', label: 'Black' },
  { value: '#4a312c', label: 'Dark brown' },
  { value: '#724133', label: 'Brown' },
  { value: '#a55728', label: 'Auburn' },
  { value: '#b58143', label: 'Light brown' },
  { value: '#d6b370', label: 'Blonde' },
  { value: '#e8e1e1', label: 'Grey' },
];

export const CLOTHING_SWATCHES: SwatchOption[] = [
  { value: '#2f6bff', label: 'Blue' },
  { value: '#1aa46a', label: 'Green' },
  { value: '#d6453d', label: 'Red' },
  { value: '#c98410', label: 'Amber' },
  { value: '#7c4ddb', label: 'Violet' },
  { value: '#3c4a60', label: 'Slate' },
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

/** DiceBear style grid offered in the customizer. Only `avataaars` is wired into
 *  `employeeAvatarUri`; the others are recorded on appearance and fall back to
 *  the seeded color resolvers for the preview (never crashes). */
export const DICEBEAR_STYLES = [
  { value: 'avataaars', label: 'avataaars' },
  { value: 'micah', label: 'micah' },
  { value: 'personas', label: 'personas' },
  { value: 'lorelei', label: 'lorelei' },
] as const;
export type DicebearStyle = (typeof DICEBEAR_STYLES)[number]['value'];

/** Working appearance shape used by the customizer — `EmployeeAppearance` plus
 *  the UI-only style + seed-override fields. */
export interface AppearanceDraft extends EmployeeAppearance {
  dicebearStyle?: DicebearStyle;
  seedOverride?: string;
}

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
    dicebearStyle: 'avataaars',
    seedOverride: employee.id,
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
    queryFn: () =>
      resolveAsync<MemoryEntry[]>(employeeId ? (MEMORY_FIXTURE[employeeId] ?? []) : []),
    enabled: employeeId !== null,
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
        { field: 'modelPreference', kind: 'add', previous: '(empty)', current: 'MiniMax-M2.7' },
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

export function useEmployeeVersions(employeeId: string | null) {
  return useQuery({
    queryKey: ['personnel', 'versions', employeeId],
    queryFn: () =>
      resolveAsync<EmployeeHistory | null>(
        employeeId ? (HISTORY_FIXTURE[employeeId] ?? null) : null,
      ),
    enabled: employeeId !== null,
  });
}
