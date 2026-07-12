/**
 * Personnel-surface view-models, zod form schema, and local query hooks.
 *
 * This file is the data SSOT for the Personnel surface only. Every shape here is
 * a Personnel-local view-model (memory entries, version history / fork
 * provenance / diffs, tool permissions, appearance option palettes, profile
 * form schema). It deliberately does not reach into `src/data/**` for visual
 * contracts; release data comes from the local repositories.
 */
import { reposOrNull } from '@/data/adapters.js';
import { buildEmployeeSystemPrompt } from '@/data/employee-persona.js';
import type { Employee } from '@/data/types.js';
import {
  type BodyType,
  type EmployeeAppearance,
  type Gender,
  type HairStyle,
  type HeadShape,
  type Outfit,
  resolveAppearance,
} from '@/lib/avatar.js';
import toyCharacterContract from '@/lib/toy-character-contract.json';
import {
  type EmployeeVersionRow,
  EmployeeVersionService,
  InMemoryEventBus,
  type MemoryEntryRow,
  type RuntimeRepositories,
} from '@offisim/core/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

// ───────────────────────── Profile form ─────────────────────────

export const COMMUNICATION_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

export const RISK_OPTIONS = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'aggressive', label: 'Aggressive' },
] as const;

export const DECISION_STYLE_OPTIONS = [
  { value: 'collaborative', label: 'Collaborative' },
  { value: 'directive', label: 'Directive' },
  { value: 'consultative', label: 'Consultative' },
  { value: 'autonomous', label: 'Autonomous' },
] as const;

/** Persona selectors accept '' = "not set" so an unedited profile never shows a
 *  fabricated preference. The runtime applies its own defaults for empty values
 *  (see `buildSystemPrompt` below, which mirrors them in the preview). */
export const profileFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.string().min(1, 'Role is required'),
  enabled: z.boolean(),
  workstation: z.string(),
  expertise: z.string(),
  workingStyle: z.string(),
  communication: z.enum(['low', 'medium', 'high']).or(z.literal('')),
  risk: z.enum(['conservative', 'balanced', 'aggressive']).or(z.literal('')),
  decisionStyle: z.string(),
  customInstructions: z.string(),
});
export type ProfileFormValues = z.infer<typeof profileFormSchema>;

/** Seed the profile form from the thin employee view-model. Persona fields
 *  start EMPTY ("not set") — never presumptuous stub values — and the real
 *  persisted persona is layered on by {@link profileDefaultsFromRecord} once
 *  the full row is read at mount. */
export function profileDefaults(employee: Employee): ProfileFormValues {
  return {
    name: employee.name,
    role: employee.role,
    enabled: !employee.disabled,
    workstation: employee.workstationId ?? '',
    expertise: (employee.expertise ?? []).join(', '),
    workingStyle: '',
    communication: '',
    risk: '',
    decisionStyle: '',
    customInstructions: '',
  };
}

const COMMUNICATION_VALUES = new Set<ProfileFormValues['communication']>(['low', 'medium', 'high']);
const RISK_VALUES = new Set<ProfileFormValues['risk']>(['conservative', 'balanced', 'aggressive']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Hydrate the profile form from the persisted employee record so reopening an
 *  employee shows their real saved persona (not the stub defaults). Mirrors the
 *  exact shape that PersonnelSurface.onSave writes: persona_json.profile. Each
 *  field falls back to the stub when missing or malformed, so a partially-
 *  written record stays valid. */
export function profileDefaultsFromRecord(
  employee: Employee,
  persona: Record<string, unknown>,
): ProfileFormValues {
  const base = profileDefaults(employee);
  const profile = isRecord(persona.profile) ? persona.profile : {};
  const str = (value: unknown, fallback: string) =>
    typeof value === 'string' && value ? value : fallback;
  return {
    ...base,
    expertise: str(profile.expertise, base.expertise),
    workingStyle: str(profile.workingStyle, base.workingStyle),
    communication: COMMUNICATION_VALUES.has(
      profile.communication as ProfileFormValues['communication'],
    )
      ? (profile.communication as ProfileFormValues['communication'])
      : base.communication,
    risk: RISK_VALUES.has(profile.risk as ProfileFormValues['risk'])
      ? (profile.risk as ProfileFormValues['risk'])
      : base.risk,
    decisionStyle: str(profile.decisionStyle, base.decisionStyle),
    customInstructions: str(profile.customInstructions, base.customInstructions),
  };
}

/** Runtime defaults applied when a persona selector was never set — MUST stay
 *  in sync with `personaFromRow` in `data/employee-persona.ts`, so the preview
 *  shows exactly what the employee's Pi sessions receive. */
export const PERSONA_RUNTIME_DEFAULTS = {
  communication: 'medium',
  risk: 'balanced',
  decisionStyle: 'collaborative',
} as const;

/** Compose the live system-prompt preview from the form state. Delegates to the
 *  shared {@link buildEmployeeSystemPrompt} and applies the same empty-value
 *  fallbacks as the runtime (`personaFromRow`), so the preview matches exactly
 *  what the employee's Pi sessions receive as `appendSystemPrompt`. */
export function buildSystemPrompt(values: ProfileFormValues, companyName: string): string {
  return buildEmployeeSystemPrompt({
    name: values.name,
    role: values.role,
    companyName,
    expertise: values.expertise,
    workingStyle: values.workingStyle,
    communication: values.communication || PERSONA_RUNTIME_DEFAULTS.communication,
    risk: values.risk || PERSONA_RUNTIME_DEFAULTS.risk,
    decisionStyle: values.decisionStyle || PERSONA_RUNTIME_DEFAULTS.decisionStyle,
    customInstructions: values.customInstructions,
  });
}

// ───────────────────────── Appearance options ─────────────────────────

export interface SwatchOption {
  value: string;
  label: string;
}

/** Curated swatch palettes — SSOT mirrors `src/lib/avatar.ts` palettes
 *  (hash-stripped hex with a leading `#` for swatch rendering). */
export const SKIN_SWATCHES: SwatchOption[] = [
  ...toyCharacterContract.skinTones.map((tone) => ({ value: `#${tone.hex}`, label: tone.label })),
];

export const HAIR_SWATCHES: SwatchOption[] = [
  ...new Map(
    toyCharacterContract.hairColors.map((color) => [
      color.hex,
      { value: `#${color.hex}`, label: color.label },
    ]),
  ).values(),
];

export const CLOTHING_SWATCHES: SwatchOption[] = [
  ...toyCharacterContract.outfitColors.map((color) => ({
    value: `#${color.hex}`,
    label: color.label,
  })),
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
  { value: 'bun', label: 'Bun' },
  { value: 'afro', label: 'Afro' },
  { value: 'mohawk', label: 'Mohawk' },
  { value: 'sidepart', label: 'Side part' },
  { value: 'undercut', label: 'Undercut' },
];

export const BODY_TYPE_OPTIONS: ReadonlyArray<{ value: BodyType; label: string }> = [
  { value: 'slim', label: 'Slim' },
  { value: 'normal', label: 'Normal' },
  { value: 'stocky', label: 'Stocky' },
];

export const HEAD_SHAPE_OPTIONS: ReadonlyArray<{ value: HeadShape; label: string }> = [
  { value: 'round', label: 'Round' },
  { value: 'soft-square', label: 'Soft square' },
  { value: 'capsule', label: 'Capsule' },
];

export const OUTFIT_OPTIONS: ReadonlyArray<{ value: Outfit; label: string }> = [
  { value: 'blazer', label: 'Blazer' },
  { value: 'shirt', label: 'Button-up' },
  { value: 'sweater', label: 'Sweater' },
  { value: 'dress', label: 'Dress' },
];

export const GENDER_OPTIONS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'masculine', label: 'Masc' },
  { value: 'feminine', label: 'Fem' },
];

export type AppearanceDraft = EmployeeAppearance;

export function appearanceDraftFor(employee: Employee): AppearanceDraft {
  // Default the enum axes to the SAME seed-derived values the office scene
  // renders (resolveAppearance(employee.id, …)), not fixed literals — otherwise
  // editing one field and saving would silently overwrite an unauthored,
  // seed-varied look (hair/body/head/gender/outfit) with a uniform default.
  const resolved = resolveAppearance(employee.id, employee.appearance);
  return {
    skinColor: resolved.skin,
    hairColor: resolved.hair,
    clothingColor: resolved.clothing,
    accentColor: resolved.accent,
    hairStyle: resolved.hairStyle,
    bodyType: resolved.bodyType,
    headShape: resolved.headShape,
    gender: resolved.gender,
    outfit: resolved.outfit,
  };
}

// ───────────────────────── Memory ─────────────────────────

export const MEMORY_CATEGORIES = ['experience', 'decision', 'knowledge', 'preference'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

type MemoryScope = 'employee' | 'company';

interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  importance: number;
  scope: MemoryScope;
  reinforced: number;
}

export function useEmployeeMemories(employeeId: string | null) {
  return useQuery({
    queryKey: ['personnel', 'memories', employeeId],
    queryFn: async () => {
      if (!employeeId) return [];
      const repos = await reposOrNull();
      if (!repos) return [] as MemoryEntry[];
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

/** Memory create/update intentionally edit only `category`, `content`, and
 *  `importance` here. `confidence` is backend-managed (set/decayed by the
 *  runtime as memories are reinforced) and is not user-editable from this
 *  surface, mirroring the other view-model narrowing in this file. */
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

type DiffKind = 'add' | 'remove' | 'change';

interface VersionDiffRow {
  field: string;
  kind: DiffKind;
  previous: string;
  current: string;
}

interface ForkProvenance {
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
    .filter((key) => summarizeSnapshotValue(selected[key]) !== summarizeSnapshotValue(current[key]))
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
      if (!repos) return null;
      const rows = await repos.employeeVersions.findByEmployee(employeeId, { limit: 24 });
      return employeeHistoryFromRows(rows);
    },
    enabled: employeeId !== null,
  });
}

/** Repo slice the version-on-save flow needs. A subset of {@link RuntimeRepositories}
 *  so the pure helper can be unit-tested against an in-memory backend. */
type VersionCapableRepos = Pick<
  RuntimeRepositories,
  'employees' | 'employeeVersions' | 'transact' | 'asyncTransact'
>;

/**
 * Record an employee version around a profile/appearance save so the History
 * tab reflects real edits (PE1). Uses the existing {@link EmployeeVersionService}
 * contract — no new versioning mechanism.
 *
 * Ordering matters for a meaningful first-edit diff:
 *  1. If no versions exist yet, snapshot a `create` baseline of the CURRENT
 *     (pre-edit) employee state — this becomes v1.
 *  2. Run the caller's `performUpdate` (the actual `employees.update`).
 *  3. Snapshot an `update` version of the post-edit state — v2 on the first
 *     save, vN+1 thereafter.
 *
 * On the first save this yields v1 (before) + v2 (after) so History shows a real
 * diff instead of an empty "No changes yet" state. Version writes never abort the
 * save: a failure to snapshot is swallowed so the employee edit still persists.
 */
export async function recordEmployeeVersionOnSave({
  repos,
  employeeId,
  performUpdate,
}: {
  repos: VersionCapableRepos;
  employeeId: string;
  performUpdate: () => Promise<void>;
}): Promise<void> {
  const service = new EmployeeVersionService(
    repos.employeeVersions,
    repos.employees,
    new InMemoryEventBus(),
    repos.transact?.bind(repos),
    repos.asyncTransact?.bind(repos),
  );

  // Capture the pre-edit baseline once, before the very first tracked save, so
  // the first edit produces a real before/after diff rather than a lone row.
  const latest = await repos.employeeVersions.getLatestVersionNum(employeeId);
  if (latest === 0) {
    await service.createVersion(employeeId, 'create');
  }

  await performUpdate();

  await service.createVersion(employeeId, 'update');
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
        undefined,
        repos.asyncTransact?.bind(repos),
      );
      await versionService.rollbackToVersion(employeeId, version);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'versions', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}
