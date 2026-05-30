import { useUiState } from '@/app/ui-state.js';
import { resolveAsync } from '@/lib/platform.js';
import { getTauriDb } from '@/lib/tauri-db.js';
import { globToRegex } from '@offisim/core/browser';
import { getBuiltinPrefab } from '@offisim/renderer';
import type {
  PrefabDefinition,
  PrefabInstanceRow,
  ZoneArchetype,
  ZoneRow,
} from '@offisim/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  companyToVm,
  employeeToVm,
  isTauriRuntime,
  projectToVm,
  reposOrNull,
  threadToVm,
} from './adapters.js';
import { companyTemplates } from './company-templates.js';
import {
  companies,
  deliverables,
  employeeSkills,
  employees,
  messages,
  officeScene,
  projectFiles,
  projects,
  threads,
  unfinishedThreads,
  usageSeries,
} from './fixtures.js';
import type {
  ChatMessage,
  Employee,
  FileNode,
  GitFileChange,
  GitWorkbench,
  RunCost,
  Skill,
  UsagePoint,
} from './types.js';

/**
 * Query hooks over the renderer data source. Browser preview can resolve
 * fixtures; release Tauri builds must use repository-backed data or fail loudly.
 */

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(companies);
      const rows = await repos.companies.findAll();
      return rows.filter((c) => c.status !== 'archived').map(companyToVm);
    },
  });
}

export function useCompanyTemplates() {
  return useQuery({
    queryKey: ['company-templates'],
    queryFn: () => resolveAsync(companyTemplates),
  });
}

export function useProjects(companyId: string | null) {
  return useQuery({
    queryKey: ['projects', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(projects.filter((p) => p.companyId === companyId));
      const rows = await repos.projects.findByCompany(companyId ?? '');
      return rows.map(projectToVm);
    },
    enabled: companyId !== null,
  });
}

export function useEmployees() {
  const companyId = useUiState((s) => s.companyId);
  return useQuery({
    queryKey: ['employees', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(employees);
      const rows = await repos.employees.findByCompany(companyId);
      return rows.map(employeeToVm);
    },
    // Guard against running findByCompany(null) before a company is selected.
    // Shares the ['employees', companyId] key with useCompanyEmployees by design
    // (identical data → React Query dedupes; invalidations target both).
    enabled: companyId !== null,
  });
}

export function useCompanyEmployees(companyId: string | null) {
  return useQuery({
    queryKey: ['employees', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync<Employee[]>(employees);
      const rows = await repos.employees.findByCompany(companyId ?? '');
      return rows.map(employeeToVm);
    },
    enabled: companyId !== null,
  });
}

type CompanyUpdateFields = Partial<{
  name: string;
  status: string;
  template_id: string | null;
  template_label: string | null;
  description_json: string | null;
}>;

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      companyId,
      fields,
    }: {
      companyId: string;
      fields: CompanyUpdateFields;
    }) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      await repos.companies.update(companyId, fields);
      return { persisted: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}

async function ensureZoneWorkstation(zone: ZoneRow): Promise<string> {
  const db = await getTauriDb();
  const now = new Date().toISOString();
  const workstationId = zone.zone_id;
  const roomType = zone.archetype ?? zone.kind;
  const position = JSON.stringify({
    kind: 'zone-assignment',
    zoneId: zone.zone_id,
    x: zone.cx,
    z: zone.cz,
  });
  const seatCapacity = Math.max(1, zone.desk_slots);

  await db.execute(
    `INSERT INTO workstations (
      workstation_id,
      company_id,
      room_type,
      label,
      position_json,
      seat_capacity,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
    ON CONFLICT(workstation_id) DO UPDATE SET
      room_type = excluded.room_type,
      label = excluded.label,
      position_json = excluded.position_json,
      seat_capacity = excluded.seat_capacity,
      updated_at = excluded.updated_at`,
    [workstationId, zone.company_id, roomType, zone.label, position, seatCapacity, now],
  );

  return workstationId;
}

/** Reassign an employee to a real workstation anchored to the selected zone. */
export function useReassignEmployee() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({ employeeId, zoneId }: { employeeId: string; zoneId: string }) => {
      const repos = await reposOrNull();
      if (!repos) return;
      const zone = await repos.zones.findById(zoneId);
      if (!zone) throw new Error(`Unknown office zone: ${zoneId}`);
      const workstationId = await ensureZoneWorkstation(zone);
      await repos.employees.update(employeeId, { workstation_id: workstationId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
    },
  });
}

export function useUpdateEmployeeEnabled() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({ employeeId, enabled }: { employeeId: string; enabled: boolean }) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      await repos.employees.update(employeeId, { enabled: enabled ? 1 : 0 });
      return { persisted: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
    },
  });
}

export function useEmployeeSkills(employeeId: string | null) {
  return useQuery({
    queryKey: ['employee-skills', employeeId],
    queryFn: () => resolveAsync<Skill[]>(employeeId ? (employeeSkills[employeeId] ?? []) : []),
    enabled: employeeId !== null,
  });
}

export function useThreads(projectId: string | null) {
  return useQuery({
    queryKey: ['threads', projectId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(threads.filter((t) => t.projectId === projectId));
      const rows = await repos.chatThreads.listByProject(projectId ?? '');
      return rows.map(threadToVm);
    },
    enabled: projectId !== null,
  });
}

export function useMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['messages', threadId],
    queryFn: async () => {
      const repos = await reposOrNull();
      // Chat messages are not a persisted DB table — they are produced live by
      // the agent runtime. A real (un-run) thread therefore has no history yet,
      // so the real backend yields an empty conversation rather than fixtures.
      if (repos) return [] as ChatMessage[];
      return resolveAsync<ChatMessage[]>(threadId ? (messages[threadId] ?? []) : []);
    },
    enabled: threadId !== null,
  });
}

export function useDeliverables() {
  const companyId = useUiState((s) => s.companyId);
  return useQuery({
    queryKey: ['deliverables', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos?.deliverables) return resolveAsync(deliverables);
      const rows = await repos.deliverables.listByCompany(companyId, { limit: 100 });
      return rows.map((r) => ({
        id: r.deliverable_id,
        name: r.title,
        kind: r.kind ?? 'doc',
        contributorIds: [] as string[],
      }));
    },
  });
}

export function useUsageSeries() {
  return useQuery({
    queryKey: ['usage-series'],
    queryFn: () => resolveAsync<UsagePoint[]>(usageSeries),
  });
}

interface LlmUsageRow {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface CostRateRow {
  provider: string;
  model_pattern: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
}

function matchesModelPattern(pattern: string, model: string): boolean {
  // Shared escape-then-translate rule (avoids drift across the renderer/core
  // glob copies). See @offisim/core's glob-match.
  return globToRegex(pattern).test(model);
}

function findCostRate(rates: CostRateRow[], provider: string, model: string): CostRateRow | null {
  const matches = rates.filter(
    (rate) =>
      rate.provider.toLowerCase() === provider.toLowerCase() &&
      matchesModelPattern(rate.model_pattern, model),
  );
  matches.sort((a, b) => b.model_pattern.length - a.model_pattern.length);
  return matches[0] ?? null;
}

function estimateCallCost(call: LlmUsageRow, rates: CostRateRow[]): number {
  const rate = findCostRate(rates, call.provider, call.model);
  if (!rate) return 0;
  // The 0.1x cache-read / 1.25x cache-write multipliers are vendor-specific:
  // correct for the cache-aware vendor, a known approximation elsewhere. On the
  // compat lane (including the default provider) the cache-token columns are not
  // populated upstream, so these terms are 0 and the approximation stays latent
  // rather than active mispricing.
  const inputCost =
    (call.input_tokens / 1_000_000) * rate.input_cost_per_mtok +
    (call.cache_read_input_tokens / 1_000_000) * rate.input_cost_per_mtok * 0.1 +
    (call.cache_creation_input_tokens / 1_000_000) * rate.input_cost_per_mtok * 1.25;
  const outputCost = (call.output_tokens / 1_000_000) * rate.output_cost_per_mtok;
  return inputCost + outputCost;
}

function formatCostLabel(cost: number): string {
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

async function loadRunCost(): Promise<RunCost> {
  if (!isTauriRuntime()) return { tokens: 0, costLabel: '$0.00', live: false };
  try {
    const db = await getTauriDb();
    const [calls, rates] = await Promise.all([
      db.select<LlmUsageRow[]>(
        `SELECT provider,
                model,
                input_tokens,
                output_tokens,
                cache_read_input_tokens,
                cache_creation_input_tokens
           FROM llm_calls`,
      ),
      db.select<CostRateRow[]>(
        `SELECT provider,
                model_pattern,
                input_cost_per_mtok,
                output_cost_per_mtok
           FROM model_cost_rates
          WHERE effective_until IS NULL OR effective_until > datetime('now')`,
      ),
    ]);
    const tokens = calls.reduce(
      (sum, call) =>
        sum +
        call.input_tokens +
        call.output_tokens +
        call.cache_read_input_tokens +
        call.cache_creation_input_tokens,
      0,
    );
    const cost = calls.reduce((sum, call) => sum + estimateCallCost(call, rates), 0);
    return { tokens, costLabel: formatCostLabel(cost), live: calls.length > 0 };
  } catch {
    // A missing/renamed cost table or column should degrade to a non-live zero
    // cost, not surface as a hard query error in the cost UI.
    return { tokens: 0, costLabel: '$0.00', live: false };
  }
}

export function useRunCost() {
  return useQuery({ queryKey: ['run-cost'], queryFn: loadRunCost });
}

export function useUnfinishedThreads() {
  return useQuery({
    queryKey: ['unfinished-threads'],
    queryFn: async () => {
      const repos = await reposOrNull();
      // A freshly bootstrapped real backend has no prior unfinished runs.
      if (repos) return [];
      return resolveAsync(unfinishedThreads);
    },
  });
}

export function useOfficeScene() {
  return useQuery({ queryKey: ['office-scene'], queryFn: () => resolveAsync(officeScene) });
}

/** Real office layout: zones + enabled prefab instances (paired with catalog
 *  definitions). Null in non-Tauri/dev so the scene falls back to its synthetic
 *  layout. */
export function useOfficeLayout(companyId: string | null) {
  return useQuery({
    queryKey: ['office-layout', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return null;
      const [zones, prefabRows] = await Promise.all([
        repos.zones.findByCompany(companyId ?? ''),
        repos.prefabInstances.findByCompany(companyId ?? ''),
      ]);
      const prefabs = prefabRows
        .filter((r) => r.enabled)
        .map((instance) => ({ instance, definition: getBuiltinPrefab(instance.prefab_id) }))
        .filter((p): p is { instance: (typeof prefabRows)[number]; definition: PrefabDefinition } =>
          Boolean(p.definition),
        );
      return { zones, prefabs };
    },
    enabled: companyId !== null,
  });
}

type ZoneUpdateFields = Partial<
  Pick<ZoneRow, 'label' | 'accent_color' | 'floor_color' | 'cx' | 'cz' | 'w' | 'd'>
>;

interface ZoneCreateFields {
  label: string;
  archetype: ZoneArchetype | null;
  accentColor: string;
  floorColor: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  deskSlots: number;
  sortOrder: number;
}

export function useUpdateZone() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({ zoneId, fields }: { zoneId: string; fields: ZoneUpdateFields }) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      await repos.zones.update(zoneId, fields);
      return { persisted: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
      queryClient.invalidateQueries({ queryKey: ['office-scene'] });
    },
  });
}

export function useCreateZone() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async (fields: ZoneCreateFields) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false, zoneId: null };
      if (!companyId) throw new Error('Select or create a company before editing the office layout');
      const zoneId = `zone-custom-${crypto.randomUUID()}`;
      await repos.zones.create({
        zone_id: zoneId,
        company_id: companyId,
        kind: 'custom',
        archetype: fields.archetype,
        label: fields.label,
        accent_color: fields.accentColor,
        floor_color: fields.floorColor,
        cx: fields.cx,
        cz: fields.cz,
        w: fields.w,
        d: fields.d,
        target_roles_json: null,
        allowed_categories_json: null,
        activity_types_json: null,
        desk_slots: fields.deskSlots,
        sort_order: fields.sortOrder,
      });
      return { persisted: true, zoneId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
      queryClient.invalidateQueries({ queryKey: ['office-scene'] });
    },
  });
}

export function useDeleteZone() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({ zoneId }: { zoneId: string }) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false, deletedObjects: 0 };
      if (!companyId) throw new Error('Select or create a company before editing the office layout');
      const prefabs = await repos.prefabInstances.findByCompanyAndZone(companyId, zoneId);
      await Promise.all(prefabs.map((prefab) => repos.prefabInstances.delete(prefab.instance_id)));
      await repos.zones.delete(zoneId);
      return { persisted: true, deletedObjects: prefabs.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
      queryClient.invalidateQueries({ queryKey: ['office-scene'] });
    },
  });
}

export function useCreatePrefabInstance() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({
      zoneId,
      prefabId,
      x,
      z,
      rotation = 0,
    }: {
      zoneId: string;
      prefabId: string;
      x: number;
      z: number;
      rotation?: PrefabInstanceRow['rotation'];
    }) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false, instanceId: null };
      if (!companyId) throw new Error('Select or create a company before editing the office layout');
      const ts = new Date().toISOString();
      const instanceId = crypto.randomUUID();
      await repos.prefabInstances.create({
        instance_id: instanceId,
        company_id: companyId,
        prefab_id: prefabId,
        zone_id: zoneId,
        position_x: x,
        position_y: z,
        rotation,
        bindings_json: null,
        config_json: null,
        enabled: 1,
        created_at: ts,
        updated_at: ts,
      });
      return { persisted: true, instanceId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
    },
  });
}

type PrefabInstanceUpdateFields = Partial<
  Pick<PrefabInstanceRow, 'position_x' | 'position_y' | 'rotation' | 'zone_id' | 'enabled'>
>;

export function useUpdatePrefabInstance() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({
      instanceId,
      fields,
    }: {
      instanceId: string;
      fields: PrefabInstanceUpdateFields;
    }) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      await repos.prefabInstances.update(instanceId, fields);
      return { persisted: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
    },
  });
}

export function useDeletePrefabInstance() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({ instanceId }: { instanceId: string }) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      await repos.prefabInstances.delete(instanceId);
      return { persisted: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
    },
  });
}

export function useProjectFiles(projectId: string | null) {
  return useQuery<FileNode[], Error>({
    queryKey: ['project-files', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      if (!isTauriRuntime()) return resolveAsync<FileNode[]>(projectFiles[projectId] ?? []);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const rows = await invoke<
          Array<{ name: string; isFile: boolean; isDirectory: boolean; path: string }>
        >('project_list_dir', {
          path: '.',
          cwd: null,
          projectId,
        });
        return rows.map((row) => ({
          name: row.name,
          path: row.path,
          kind: row.isDirectory ? 'dir' : 'file',
          depth: row.path.split('/').length - 1,
        }));
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : 'Project file listing failed');
      }
    },
    enabled: projectId !== null,
  });
}

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function gitErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Git workspace unavailable';
}

function isNonGitWorkspace(result: GitExecResult | string): boolean {
  const message = typeof result === 'string' ? result : `${result.stderr}\n${result.stdout}`;
  return (
    message.includes('not a git repository') ||
    message.includes('No workspace_root is bound') ||
    message.includes('Resolve project workspace')
  );
}

async function runGit(projectId: string, args: string[]): Promise<GitExecResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<GitExecResult>('git_exec', { projectId, args, cwd: null });
}

function parseStatusLine(rawLine: string): GitFileChange | null {
  if (!rawLine || rawLine.startsWith('##')) return null;
  const x = rawLine[0] ?? ' ';
  const y = rawLine[1] ?? ' ';
  const pathPart = rawLine.slice(3).trim();
  if (!pathPart) return null;
  const statusCode = x === ' ' || x === '?' ? y : x;
  const status: GitFileChange['status'] =
    statusCode === 'A' || statusCode === '?' ? 'added'
    : statusCode === 'D' ? 'deleted'
    : statusCode === 'R' ? 'renamed'
    : 'modified';
  const path = status === 'renamed' ? (pathPart.split(' -> ').at(-1) ?? pathPart) : pathPart;
  return {
    path,
    status,
    staged: x !== ' ' && x !== '?',
    added: 0,
    removed: 0,
  };
}

function parseBranch(statusHeader: string | undefined): Pick<GitWorkbench, 'branch' | 'ahead' | 'behind'> {
  if (!statusHeader?.startsWith('## ')) return { branch: 'detached', ahead: 0, behind: 0 };
  const value = statusHeader.slice(3).trim();
  const branch = value.split('...')[0]?.replace('No commits yet on ', '').trim() || 'detached';
  const ahead = Number(value.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(value.match(/behind (\d+)/)?.[1] ?? 0);
  return { branch, ahead, behind };
}

function parseNumstat(stdout: string): Map<string, Pick<GitFileChange, 'added' | 'removed'>> {
  const stats = new Map<string, Pick<GitFileChange, 'added' | 'removed'>>();
  for (const line of stdout.split('\n')) {
    const [addedRaw, removedRaw, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t').trim();
    if (!path) continue;
    const added = Number.parseInt(addedRaw ?? '0', 10);
    const removed = Number.parseInt(removedRaw ?? '0', 10);
    stats.set(path, {
      added: Number.isFinite(added) ? added : 0,
      removed: Number.isFinite(removed) ? removed : 0,
    });
  }
  return stats;
}

function parseDiffPreview(stdout: string): GitWorkbench['diffPreview'] {
  return stdout
    .split('\n')
    .filter((line) => line && !line.startsWith('diff --git') && !line.startsWith('index '))
    .slice(0, 80)
    .map((line) => ({
      kind: line.startsWith('+') && !line.startsWith('+++') ? 'add'
        : line.startsWith('-') && !line.startsWith('---') ? 'remove'
        : 'context',
      text: line.replace(/^[+-]/, ''),
    }));
}

async function loadGitWorkbench(projectId: string): Promise<GitWorkbench | null> {
  const status = await runGit(projectId, ['status', '--porcelain=v1', '--branch']);
  if (!status.ok) {
    if (isNonGitWorkspace(status)) return null;
    throw new Error(status.stderr.trim() || status.stdout.trim() || 'Git status failed');
  }

  const statusLines = status.stdout.split('\n').filter(Boolean);
  const branch = parseBranch(statusLines.find((line) => line.startsWith('## ')));
  const changes = statusLines.map(parseStatusLine).filter((row): row is GitFileChange => Boolean(row));
  const [unstagedStats, stagedStats, diffPreview] = await Promise.all([
    runGit(projectId, ['diff', '--numstat']),
    runGit(projectId, ['diff', '--cached', '--numstat']),
    runGit(projectId, ['diff', '--unified=2']),
  ]);
  const stats = new Map([
    ...parseNumstat(unstagedStats.ok ? unstagedStats.stdout : ''),
    ...parseNumstat(stagedStats.ok ? stagedStats.stdout : ''),
  ]);

  return {
    ...branch,
    changes: changes.map((change) => ({ ...change, ...(stats.get(change.path) ?? {}) })),
    diffPreview: parseDiffPreview(diffPreview.ok ? diffPreview.stdout : ''),
    checks: [
      {
        id: 'git-status',
        label: changes.length === 0 ? 'clean tree' : 'local changes',
        state: changes.length === 0 ? 'pass' : 'running',
      },
    ],
  };
}

export function useGitWorkbench(projectId: string | null) {
  return useQuery<GitWorkbench | null, Error>({
    queryKey: ['git-workbench', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      if (!isTauriRuntime()) return null;
      try {
        return await loadGitWorkbench(projectId);
      } catch (error) {
        const message = gitErrorMessage(error);
        if (isNonGitWorkspace(message)) return null;
        throw new Error(message);
      }
    },
    enabled: projectId !== null,
  });
}
