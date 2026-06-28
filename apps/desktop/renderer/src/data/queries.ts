import { useUiState } from '@/app/ui-state.js';
import { loadPersistedChatMessages } from '@/data/chat-message-events.js';
import { resolveAsync } from '@/lib/platform.js';
import { getTauriDb } from '@/lib/tauri-db.js';
import { buildWizardTemplates } from '@/surfaces/lifecycle/template-view.js';
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
  employeeToVm,
  isTauriRuntime,
  projectToVm,
  reposOrNull,
  threadToVm,
} from './adapters.js';
import {
  companies,
  deliverables,
  employeeSkills,
  employees,
  messages,
  projectFiles,
  projects,
  threads,
} from './fixtures.js';
import { gitErrorMessage, isNonGitWorkspace, loadGitWorkbench } from './git-workbench.js';
import { deleteCompanyDeep, deleteConversationDeep } from './local-data-deletion.js';
import { loadRunCost } from './run-cost.js';
import type {
  ChatMessage,
  ChatThread,
  Deliverable,
  Employee,
  FileNode,
  GitWorkbench,
  Skill,
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
    // Templates are static, canonical core data — no I/O. Returns the 5 built-in
    // templates; the wizard appends the renderer-only "Create your own" entry.
    queryFn: () => resolveAsync(buildWizardTemplates()),
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

interface PersistenceResult {
  persisted: boolean;
}

interface DeleteCompanyResult extends PersistenceResult {
  workspaceCleanupError?: string;
  missing?: boolean;
}

interface ThreadMutationResult extends PersistenceResult {
  missing?: boolean;
}

interface CompanyMutationResult extends PersistenceResult {
  missing?: boolean;
}

export interface ProjectChatThreadRow {
  thread_id: string;
  project_id: string;
  employee_id?: string | null;
  title: string;
  summary: string | null;
  updated_at: string;
  run_status?: string | null;
}

export const projectChatThreadRowsQueryKey = (projectId: string | null) =>
  ['threads', projectId] as const;

function fixtureThreadToRow(thread: ChatThread): ProjectChatThreadRow {
  return {
    thread_id: thread.id,
    project_id: thread.projectId,
    employee_id: thread.employeeId,
    title: thread.title,
    summary: thread.subtitle,
    updated_at: new Date(thread.updatedAt).toISOString(),
    run_status:
      thread.runState === 'running'
        ? 'running'
        : thread.runState === 'paused'
          ? 'paused'
          : thread.runState === 'error'
            ? 'failed'
            : thread.runState === 'done'
              ? 'completed'
              : 'idle',
  };
}

export async function loadProjectChatThreadRows(
  projectId: string | null,
): Promise<ProjectChatThreadRow[]> {
  const repos = await reposOrNull();
  if (!repos) {
    return resolveAsync(
      threads.filter((thread) => thread.projectId === projectId).map(fixtureThreadToRow),
    );
  }
  const rows = (await repos.chatThreads.listByProject(projectId ?? '')) as ProjectChatThreadRow[];
  if (rows.length === 0) return [];
  const db = await getTauriDb();
  const placeholders = rows.map((_, index) => `$${index + 1}`).join(', ');
  const statusRows = await db.select<Array<{ thread_id: string; status: string }>>(
    `SELECT thread_id, status FROM graph_threads WHERE thread_id IN (${placeholders})`,
    rows.map((row) => row.thread_id),
  );
  const statusByThread = new Map(statusRows.map((row) => [row.thread_id, row.status]));
  return rows.map((row) => ({ ...row, run_status: statusByThread.get(row.thread_id) ?? null }));
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      companyId,
      fields,
    }: {
      companyId: string;
      fields: CompanyUpdateFields;
    }): Promise<CompanyMutationResult> => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      const existing = await repos.companies.findById(companyId);
      if (!existing) return { persisted: false, missing: true };
      await repos.companies.update(companyId, fields);
      return { persisted: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}

export function useDeleteCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ companyId }: { companyId: string }): Promise<DeleteCompanyResult> => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      const existing = await repos.companies.findById(companyId);
      if (!existing) return { persisted: false, missing: true };
      return deleteCompanyDeep(companyId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['companies'] }),
        queryClient.invalidateQueries({ queryKey: ['activity-records'] }),
        queryClient.invalidateQueries({ queryKey: ['threads'] }),
        queryClient.invalidateQueries({ queryKey: ['messages'] }),
        queryClient.invalidateQueries({ queryKey: ['deliverables'] }),
      ]);
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

interface RuntimeMcpToolInfo {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  input_schema?: unknown;
  annotations?: unknown;
}

interface RuntimeMcpServerStatus {
  name?: unknown;
  state?: unknown;
  tools?: RuntimeMcpToolInfo[];
}

interface EmployeeMcpTool {
  id: string;
  serverName: string;
  toolName: string;
  title: string;
  description: string;
  readOnly: boolean;
  grantedAt: string;
}

function normalizeMcpAnnotations(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  return {
    ...record,
    readOnlyHint: record.readOnlyHint ?? record.read_only_hint,
    destructiveHint: record.destructiveHint ?? record.destructive_hint,
    idempotentHint: record.idempotentHint ?? record.idempotent_hint,
    openWorldHint: record.openWorldHint ?? record.open_world_hint,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isWriteMcpTool(toolName: string, annotations: Record<string, unknown>): boolean {
  if (annotations.readOnlyHint === false || annotations.destructiveHint === true) return true;
  return /(^|_)(write|delete|remove|move|copy|create|edit|update|append|mkdir|touch)(_|$)/i.test(
    toolName,
  );
}

export function useEmployeeMcpTools(employeeId: string | null) {
  const companyId = useUiState((s) => s.companyId);
  return useQuery<EmployeeMcpTool[]>({
    queryKey: ['employee-mcp-tools', companyId, employeeId],
    queryFn: async () => {
      if (!companyId || !employeeId) return [];
      const repos = await reposOrNull();
      if (!repos?.mcpToolGrants || !isTauriRuntime()) return [];
      const { invoke } = await import('@tauri-apps/api/core');
      const [grants, statuses] = await Promise.all([
        repos.mcpToolGrants.listByEmployee(companyId, employeeId),
        invoke<RuntimeMcpServerStatus[]>('mcp_list_servers'),
      ]);
      const connected = new Map(
        statuses
          .filter((server) => server.state === 'ready' && stringValue(server.name))
          .map((server) => [stringValue(server.name) ?? '', server] as const),
      );
      const tools: EmployeeMcpTool[] = [];
      for (const grant of grants) {
        const server = connected.get(grant.server_name);
        if (!server) continue;
        const tool = (server.tools ?? []).find((candidate) => candidate.name === grant.tool_name);
        if (!tool) continue;
        const annotations = normalizeMcpAnnotations(tool.annotations);
        const title = stringValue(annotations.title) ?? grant.tool_name;
        const description = stringValue(tool.description) ?? 'No description provided.';
        tools.push({
          id: `${grant.server_name}:${grant.tool_name}`,
          serverName: grant.server_name,
          toolName: grant.tool_name,
          title,
          description,
          readOnly: !isWriteMcpTool(grant.tool_name, annotations),
          grantedAt: grant.created_at,
        });
      }
      return tools.sort((a, b) =>
        a.serverName === b.serverName
          ? a.toolName.localeCompare(b.toolName)
          : a.serverName.localeCompare(b.serverName),
      );
    },
    enabled: Boolean(companyId && employeeId),
    placeholderData: [],
    refetchOnMount: 'always',
  });
}

export function useThreads(projectId: string | null) {
  return useQuery({
    queryKey: projectChatThreadRowsQueryKey(projectId),
    queryFn: () => loadProjectChatThreadRows(projectId),
    enabled: projectId !== null,
    select: (rows) => rows.map(threadToVm),
  });
}

export function useRenameThread(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      title,
    }: {
      threadId: string;
      title: string;
    }): Promise<ThreadMutationResult> => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      const existing = await repos.chatThreads.findById(threadId);
      if (!existing) return { persisted: false, missing: true };
      await repos.chatThreads.updateTitle(threadId, title, { byUser: true });
      return { persisted: true };
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['threads', projectId] })]);
    },
  });
}

export function useArchiveThread(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }): Promise<ThreadMutationResult> => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      const existing = await repos.chatThreads.findById(threadId);
      if (!existing) return { persisted: false, missing: true };
      await repos.chatThreads.archive(threadId);
      return { persisted: true };
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['threads', projectId] })]);
    },
  });
}

export function useDeleteConversation(projectId: string | null, companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }): Promise<ThreadMutationResult> => {
      const repos = await reposOrNull();
      if (!repos) return { persisted: false };
      const existing = await repos.chatThreads.findById(threadId);
      if (!existing) return { persisted: false, missing: true };
      const project = await repos.projects.findById(existing.project_id);
      await deleteConversationDeep(threadId, project?.company_id ?? companyId);
      return { persisted: true };
    },
    onSuccess: async (_result, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['messages', vars.threadId] }),
        queryClient.invalidateQueries({ queryKey: ['deliverables', companyId, vars.threadId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-records', companyId ?? ''] }),
      ]);
    },
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
      // ST3: deleting a zone removes its prefab instances too (there is no FK
      // cascade from prefab_instances.zone_id). Those N deletes + the zone delete
      // must be ONE transaction, else a mid-op failure orphans prefabs or leaves
      // a deleted zone with leftover prefabs. Use the Tauri transaction when the
      // backend provides it; other backends (single-process) run sequentially.
      const asyncTransact = repos.asyncTransact?.bind(repos);
      if (asyncTransact) {
        await asyncTransact(async (tx) => {
          if (!tx) throw new Error('zone delete requires a transactional repository');
          await Promise.all(prefabs.map((prefab) => tx.prefabInstances.delete(prefab.instance_id)));
          await tx.zones.delete(zoneId);
        });
      } else {
        await Promise.all(
          prefabs.map((prefab) => repos.prefabInstances.delete(prefab.instance_id)),
        );
        await repos.zones.delete(zoneId);
      }
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
