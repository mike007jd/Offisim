import type { EmployeeAppearance } from '@/lib/avatar.js';
import { initialsOf } from '@/lib/utils.js';
import { getRepos } from '@/runtime/repos.js';
import type { RuntimeRepositories } from '@offisim/core/browser';
import { ACCENT_PAIRS } from './color-palette.js';
import type { ChatThread, Company, Employee, Project, RunState } from './types.js';

/**
 * Real-backend adapters: map SQLite repo rows → renderer view-model types so the
 * UI renders REAL company/employee/project data with no shape changes upstream.
 * Release Tauri builds must surface repository failures instead of silently
 * rendering fake preview state as success.
 */

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Resolve repos; only browser preview is allowed to return null. */
export async function reposOrNull(): Promise<RuntimeRepositories | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await getRepos();
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(
      typeof error === 'string' && error.trim()
        ? error
        : 'Desktop runtime repositories unavailable',
    );
  }
}

function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function accentPair(seed: string): [string, string] {
  const fallback = ACCENT_PAIRS[0];
  const pair = ACCENT_PAIRS[hash(seed) % ACCENT_PAIRS.length] ?? fallback;
  if (!pair) return ['var(--off-accent)', 'var(--off-violet)'];
  return [pair[0], pair[1]];
}

interface CompanyRowLike {
  company_id: string;
  name: string;
  template_label?: string | null;
}
export function companyToVm(row: CompanyRowLike): Company {
  const [a, b] = accentPair(row.company_id);
  return {
    id: row.company_id,
    name: row.name,
    initials: initialsOf(row.name),
    accentA: a,
    accentB: b,
    templateLabel: row.template_label?.trim() || 'Custom',
  };
}

/** Template personas store appearance colors as legacy 0xRRGGBB NUMBERS (and use
 *  `clothingAccent` instead of `accentColor`). Normalize to the renderer's hex-string
 *  EmployeeAppearance so the avatar/3D code (which calls string methods) is safe. */
function toHex(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.startsWith('#') ? value : `#${value}`;
  }
  return undefined;
}

export function normalizeAppearance(raw: unknown): EmployeeAppearance | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const out: EmployeeAppearance = {};
  const skin = toHex(a.skinColor);
  const hair = toHex(a.hairColor);
  const clothing = toHex(a.clothingColor);
  const accent = toHex(a.accentColor ?? a.clothingAccent);
  if (skin) out.skinColor = skin;
  if (hair) out.hairColor = hair;
  if (clothing) out.clothingColor = clothing;
  if (accent) out.accentColor = accent;
  if (typeof a.hairStyle === 'string')
    out.hairStyle = a.hairStyle as EmployeeAppearance['hairStyle'];
  if (typeof a.bodyType === 'string') out.bodyType = a.bodyType as EmployeeAppearance['bodyType'];
  if (typeof a.headShape === 'string')
    out.headShape = a.headShape as EmployeeAppearance['headShape'];
  if (typeof a.gender === 'string') out.gender = a.gender as EmployeeAppearance['gender'];
  if (typeof a.outfit === 'string') out.outfit = a.outfit as EmployeeAppearance['outfit'];
  return Object.keys(out).length > 0 ? out : undefined;
}

interface EmployeeRowLike {
  employee_id: string;
  name: string;
  role_slug: string;
  workstation_id: string | null;
  enabled: number;
  is_external: number;
  brand_key: string | null;
  persona_json: string | null;
  config_json: string | null;
  model: string | null;
  thinking_level: string | null;
}
export function employeeToVm(row: EmployeeRowLike): Employee {
  const [a, b] = accentPair(row.employee_id);
  let appearance: EmployeeAppearance | undefined;
  const discipline = humanizeRole(row.role_slug);
  const model = row.model?.trim() || null;
  try {
    const persona = row.persona_json ? JSON.parse(row.persona_json) : null;
    if (persona?.appearance) appearance = normalizeAppearance(persona.appearance);
  } catch {
    /* persona JSON malformed — fall back to role-derived appearance */
  }
  return {
    id: row.employee_id,
    name: row.name,
    role: discipline,
    kind: row.is_external === 1 ? 'external' : 'internal',
    brandLabel: row.brand_key ?? undefined,
    online: row.enabled === 1,
    disabled: row.enabled !== 1,
    avatarA: a,
    avatarB: b,
    appearance,
    discipline,
    roleSlug: row.role_slug as Employee['roleSlug'],
    model,
    thinkingLevel: row.thinking_level?.trim() || null,
    modelLabel: model ?? 'Inherit conversation model',
    skillCount: 0,
    workstationId: row.workstation_id,
  };
}

interface ProjectRowLike {
  project_id: string;
  company_id: string;
  name: string;
  workspace_root: string | null;
}
export function projectToVm(row: ProjectRowLike): Project {
  return {
    id: row.project_id,
    companyId: row.company_id,
    name: row.name,
    workspaceRoot: row.workspace_root,
    branch: null,
  };
}

interface ChatThreadRowLike {
  thread_id: string;
  project_id: string;
  employee_id?: string | null;
  title: string;
  summary: string | null;
  updated_at: string;
  run_status?: string | null;
}
/** Render-layer thread title. The persisted default stays 'New thread' (DB
 *  schema default + core auto-title fallback contract); the product vocabulary
 *  shows it as a conversation. */
export function displayThreadTitle(title: string | null | undefined): string {
  const trimmed = title?.trim();
  return !trimmed || trimmed === 'New thread' ? 'New conversation' : trimmed;
}

function runStateFromGraphStatus(status: string | null | undefined): RunState {
  if (status === 'queued' || status === 'running') return 'running';
  if (status === 'paused') return 'paused';
  if (status === 'blocked' || status === 'failed' || status === 'error') return 'error';
  if (status === 'completed') return 'done';
  return 'idle';
}

export function threadToVm(row: ChatThreadRowLike): ChatThread {
  return {
    id: row.thread_id,
    projectId: row.project_id,
    title: displayThreadTitle(row.title),
    subtitle: row.summary ?? 'Team conversation',
    scope: row.employee_id ? 'direct' : 'team',
    employeeId: row.employee_id ?? null,
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    runState: runStateFromGraphStatus(row.run_status),
  };
}

const ROLE_ACRONYMS = new Set([
  'qa',
  'ux',
  'ui',
  'ai',
  'pm',
  'hr',
  'it',
  'ml',
  'api',
  'sre',
  'dba',
  'sdk',
  'vp',
  'cto',
  'ceo',
  'cpo',
]);

function humanizeRole(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) =>
      ROLE_ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

/** Role line for an employee row/header, or null when it just echoes the name
 *  (seed employees like "YOLO Master" get role === name after humanizing). */
export function displayRole(employee: Pick<Employee, 'name' | 'role'>): string | null {
  return employee.role.toLowerCase() === employee.name.toLowerCase() ? null : employee.role;
}
