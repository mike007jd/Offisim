import { useUiState } from '@/app/ui-state.js';
import { loadPersistedChatMessages } from '@/data/chat-message-events.js';
import { resolveAsync } from '@/lib/platform.js';
import { getTauriDb } from '@/lib/tauri-db.js';
import { getBuiltinPrefab } from '@offisim/renderer';
import type {
  ActivityType,
  PrefabDefinition,
  PrefabInstanceRow,
  SemanticCategory,
  ZoneArchetype,
  ZoneRow,
} from '@offisim/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  companyToVm,
  displayThreadTitle,
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
} from './fixtures.js';
import { gitErrorMessage, isNonGitWorkspace, loadGitWorkbench } from './git-workbench.js';
import { loadRunCost } from './run-cost.js';
import type {
  ChatMessage,
  Deliverable,
  Employee,
  FileNode,
  GitWorkbench,
  Skill,
  UnfinishedThread,
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
  const companyId = useUiState((s) => s.companyId);
  return useQuery({
    queryKey: ['employee-skills', companyId, employeeId],
    queryFn: async () => {
      if (!employeeId) return [] as Skill[];
      const repos = await reposOrNull();
      // Browser preview (no Tauri repos): keep the demo fixture so the surface
      // still renders. Release always has repos and reads the real skills table —
      // matching useEmployeeMemories / useEmployeeVersions, not a fixture seam.
      if (!repos?.skills) return resolveAsync<Skill[]>(employeeSkills[employeeId] ?? []);
      // An employee's effective skill set = the company-global skills that apply
      // to everyone plus this employee's own (employee-scoped) skills. The two
      // queries are disjoint (employee_id IS NULL vs = id), so no dedup needed.
      const [companyScoped, personal] = await Promise.all([
        repos.skills.listByCompanyScope(companyId ?? ''),
        repos.skills.listByEmployee(companyId ?? '', employeeId),
      ]);
      return [...companyScoped, ...personal].map<Skill>((row) => ({
        id: row.skill_id,
        name: row.name,
        description: row.description,
        // DB scope is only 'company' | 'employee'; the view-model's 'global'
        // tier is never produced by the real source.
        scope: row.scope === 'employee' ? 'employee' : 'company',
      }));
    },
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
      // the direct desktop provider path and stored as agent event rows.
      if (repos) return loadPersistedChatMessages(threadId ?? '');
      return resolveAsync<ChatMessage[]>(threadId ? (messages[threadId] ?? []) : []);
    },
    enabled: threadId !== null,
  });
}

const TEMP_DELIVERABLE_RE = /(^|[/\\])(?:tmp|temp|\.tmp)([/\\]|$)|ui-tool-deliverable/i;

function deliverableFormat(
  title: string,
  fileName: string | null,
  mimeType: string | null,
): string {
  const source = fileName?.trim() || title.trim();
  const [, ext] = /\.([^.]+)$/.exec(source) ?? [];
  if (ext) return ext.toUpperCase();
  if (mimeType?.includes('markdown')) return 'MD';
  if (mimeType?.includes('json')) return 'JSON';
  if (mimeType?.startsWith('text/')) return 'TXT';
  return 'TXT';
}

function deliverableVisible(input: {
  title: string;
  fileName?: string | null;
  kind?: string | null;
}) {
  const title = input.title.trim();
  const fileName = input.fileName?.trim() ?? '';
  if (!title) return false;
  if (TEMP_DELIVERABLE_RE.test(title) || TEMP_DELIVERABLE_RE.test(fileName)) return false;
  const kind = input.kind?.toLowerCase() ?? '';
  return kind !== 'debug' && kind !== 'diagnostic' && kind !== 'temp' && kind !== 'temporary';
}

export function useDeliverables(threadId: string | null) {
  const companyId = useUiState((s) => s.companyId);
  return useQuery({
    queryKey: ['deliverables', companyId, threadId],
    queryFn: async () => {
      if (companyId === null || threadId === null) return [] as Deliverable[];
      const repos = await reposOrNull();
      if (!repos?.deliverables)
        return resolveAsync(
          deliverables.filter(
            (deliverable) =>
              deliverable.threadId === threadId &&
              deliverableVisible({
                title: deliverable.name,
                fileName: deliverable.fileName,
                kind: deliverable.kind,
              }),
          ),
        );
      const rows = await repos.deliverables.listByCompany(companyId, {
        threadId,
        limit: 40,
      });
      return rows
        .filter((r) => deliverableVisible({ title: r.title, fileName: r.file_name, kind: r.kind }))
        .map((r) => ({
          id: r.deliverable_id,
          threadId: r.chat_thread_id ?? r.thread_id,
          name: r.file_name?.trim() || r.title,
          kind: r.kind ?? 'document',
          contributorIds: [],
          fileName: r.file_name,
          mimeType: r.mime_type,
          contentSize: r.content_size,
          format: deliverableFormat(r.title, r.file_name, r.mime_type),
        }));
    },
    enabled: companyId !== null && threadId !== null,
  });
}

export async function loadDeliverableBody(deliverable: Deliverable): Promise<string> {
  if (deliverable.preview !== undefined) return deliverable.preview;
  const repos = await reposOrNull();
  if (!repos?.deliverables) {
    return deliverables.find((fixture) => fixture.id === deliverable.id)?.preview ?? '';
  }
  const row = await repos.deliverables.findById(deliverable.id);
  return row?.content ?? '';
}

export function useRunCost() {
  return useQuery({ queryKey: ['run-cost'], queryFn: loadRunCost });
}

const NON_TERMINAL_THREAD_STATUSES = ['queued', 'running', 'blocked', 'paused'] as const;
const RESUMABLE_ENTRY_MODES = ['direct_chat', 'boss_chat', 'meeting'] as const;

interface UnfinishedThreadRow {
  thread_id: string;
  company_id: string;
  project_id: string | null;
  status: string;
  title: string | null;
}

export function useUnfinishedThreads() {
  return useQuery({
    queryKey: ['unfinished-threads'],
    queryFn: async (): Promise<UnfinishedThread[]> => {
      const repos = await reposOrNull();
      // Browser preview has no repos — resolve the fixture.
      if (!repos) return resolveAsync(unfinishedThreads);

      const db = await getTauriDb();
      const rows = await db.select<UnfinishedThreadRow[]>(
        `SELECT gt.thread_id,
                gt.company_id,
                gt.project_id,
                gt.status,
                ct.title
           FROM graph_threads gt
           JOIN companies c ON c.company_id = gt.company_id
      LEFT JOIN chat_threads ct ON ct.thread_id = gt.thread_id
          WHERE c.status <> 'archived'
            AND gt.status IN (${NON_TERMINAL_THREAD_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
            AND gt.entry_mode IN (${RESUMABLE_ENTRY_MODES.map(
              (_, i) => `$${NON_TERMINAL_THREAD_STATUSES.length + i + 1}`,
            ).join(', ')})
       ORDER BY gt.created_at DESC`,
        [...NON_TERMINAL_THREAD_STATUSES, ...RESUMABLE_ENTRY_MODES],
      );
      return rows.map((row) => ({
        threadId: row.thread_id,
        companyId: row.company_id,
        projectId: row.project_id ?? '',
        name: displayThreadTitle(row.title),
        state: row.status === 'blocked' ? 'blocked' : 'running',
      }));
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
  allowedCategories?: readonly SemanticCategory[];
  activityTypes?: readonly ActivityType[];
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
      if (!companyId)
        throw new Error('Select or create a company before editing the office layout');
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
        allowed_categories_json:
          fields.allowedCategories && fields.allowedCategories.length > 0
            ? JSON.stringify(fields.allowedCategories)
            : null,
        activity_types_json:
          fields.activityTypes && fields.activityTypes.length > 0
            ? JSON.stringify(fields.activityTypes)
            : null,
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
      if (!companyId)
        throw new Error('Select or create a company before editing the office layout');
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

/** Cache value shape produced by useOfficeLayout — the optimistic mutations
 *  below patch it in place so a placed/moved object is visible to the very next
 *  collision probe instead of waiting for the post-commit refetch. */
type OfficeLayoutData = {
  zones: ZoneRow[];
  prefabs: { instance: PrefabInstanceRow; definition: PrefabDefinition }[];
};

export function useCreatePrefabInstance() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({
      instanceId,
      zoneId,
      prefabId,
      x,
      z,
      rotation = 0,
    }: {
      instanceId: string;
      zoneId: string;
      prefabId: string;
      x: number;
      z: number;
      rotation?: PrefabInstanceRow['rotation'];
    }) => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false, instanceId: null };
      if (!companyId)
        throw new Error('Select or create a company before editing the office layout');
      const ts = new Date().toISOString();
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
    // Optimistically insert the new object so the next placement click probes
    // collisions against it (closes the rapid repeat-click overlap window).
    onMutate: async ({ instanceId, zoneId, prefabId, x, z, rotation = 0 }) => {
      const definition = getBuiltinPrefab(prefabId);
      if (!companyId || !definition) return { previous: undefined };
      const key = ['office-layout', companyId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OfficeLayoutData | null>(key);
      const ts = new Date().toISOString();
      const instance: PrefabInstanceRow = {
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
      };
      queryClient.setQueryData<OfficeLayoutData | null>(key, (current) =>
        current ? { ...current, prefabs: [...current.prefabs, { instance, definition }] } : current,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['office-layout', companyId], context.previous);
      }
    },
    onSettled: () => {
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
    // Optimistically patch position/rotation/zone so a moved object stays under
    // the cursor across the DB round-trip instead of snapping back then jumping.
    onMutate: async ({ instanceId, fields }) => {
      if (!companyId) return { previous: undefined };
      const key = ['office-layout', companyId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OfficeLayoutData | null>(key);
      queryClient.setQueryData<OfficeLayoutData | null>(key, (current) =>
        current
          ? {
              ...current,
              prefabs: current.prefabs.map((p) =>
                p.instance.instance_id === instanceId
                  ? { ...p, instance: { ...p.instance, ...fields } }
                  : p,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['office-layout', companyId], context.previous);
      }
    },
    onSettled: () => {
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
