import type { EmployeeAppearance } from '@/lib/avatar.js';
import { getRepos } from '@/runtime/repos.js';
import type { RuntimeRepositories } from '@offisim/core/browser';
import type { ChatThread, Company, Employee, Project } from './types.js';

/**
 * Real-backend adapters: map SQLite repo rows → renderer view-model types so the
 * UI renders REAL company/employee/project data with no shape changes upstream.
 * In a non-Tauri context (dev webview without tauri-plugin-sql) the caller falls
 * back to fixtures; in the release app this is the only data source.
 */

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Resolve repos, or null when the backend is unavailable (non-Tauri/dev). */
export async function reposOrNull(): Promise<RuntimeRepositories | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await getRepos();
  } catch {
    return null;
  }
}

const ACCENTS: ReadonlyArray<[string, string]> = [
  ['#4d82ff', '#7c4ddb'],
  ['#1aa46a', '#0e7c8b'],
  ['#e8833a', '#d8542f'],
  ['#7c4ddb', '#4d82ff'],
  ['#0e7c8b', '#1aa46a'],
  ['#d8542f', '#e8833a'],
];

function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function accentPair(seed: string): [string, string] {
  return ACCENTS[hash(seed) % ACCENTS.length] ?? ['#4d82ff', '#7c4ddb'];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '??').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

interface CompanyRowLike {
  company_id: string;
  name: string;
}
export function companyToVm(row: CompanyRowLike): Company {
  const [a, b] = accentPair(row.company_id);
  return {
    id: row.company_id,
    name: row.name,
    initials: initials(row.name),
    accentA: a,
    accentB: b,
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

function normalizeAppearance(raw: unknown): EmployeeAppearance | undefined {
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
  if (typeof a.gender === 'string') out.gender = a.gender as EmployeeAppearance['gender'];
  return Object.keys(out).length > 0 ? out : undefined;
}

interface EmployeeRowLike {
  employee_id: string;
  name: string;
  role_slug: string;
  enabled: number;
  is_external: number;
  brand_key: string | null;
  persona_json: string | null;
  config_json: string | null;
}
export function employeeToVm(row: EmployeeRowLike): Employee {
  const [a, b] = accentPair(row.employee_id);
  let appearance: EmployeeAppearance | undefined;
  const discipline = humanizeRole(row.role_slug);
  let modelLabel = 'MiniMax-M2.7';
  try {
    const persona = row.persona_json ? JSON.parse(row.persona_json) : null;
    if (persona?.appearance) appearance = normalizeAppearance(persona.appearance);
  } catch {
    /* persona JSON malformed — fall back to role-derived appearance */
  }
  try {
    const config = row.config_json ? JSON.parse(row.config_json) : null;
    if (typeof config?.modelPreference === 'string' && config.modelPreference.trim()) {
      modelLabel = config.modelPreference.trim();
    }
  } catch {
    /* config JSON malformed — keep default model label */
  }
  return {
    id: row.employee_id,
    name: row.name,
    role: humanizeRole(row.role_slug),
    kind: row.is_external === 1 ? 'external' : 'internal',
    brandLabel: row.brand_key ?? undefined,
    online: row.enabled === 1,
    avatarA: a,
    avatarB: b,
    appearance,
    discipline,
    modelLabel,
    skillCount: 0,
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
  title: string;
  summary: string | null;
  updated_at: string;
}
export function threadToVm(row: ChatThreadRowLike): ChatThread {
  return {
    id: row.thread_id,
    projectId: row.project_id,
    title: row.title,
    subtitle: row.summary ?? 'Team thread',
    scope: 'team',
    employeeId: null,
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    runState: 'idle',
  };
}

function humanizeRole(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
