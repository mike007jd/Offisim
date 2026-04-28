// ── Canonical role registry ─────────────────────────────────────────
// This is the SINGLE SOURCE OF TRUTH for role slugs across the entire
// Offisim codebase.  Every consumer should derive from these exports
// instead of maintaining its own mapping.

/** Canonical role slug — the ONLY place new roles are defined. */
export type RoleSlug =
  // System / management
  | 'boss'
  | 'hr'
  | 'manager'
  | 'product_manager'
  | 'project_manager'
  | 'account_manager'
  | 'engineering_manager'
  | 'yolo_master'
  // Dev
  | 'developer'
  | 'engineer'
  | 'backend'
  | 'frontend'
  | 'fullstack'
  | 'data_engineer'
  | 'devops'
  // Art
  | 'designer'
  | 'artist'
  | 'ui_designer'
  | 'ux_designer'
  | 'graphic_designer'
  // Content
  | 'writer'
  | 'marketer'
  | 'seo_specialist'
  // Analysis / Product
  | 'pm'
  | 'analyst'
  | 'researcher'
  | 'qa';

export type Department = 'dev' | 'art' | 'product' | 'content' | 'ops';

export interface RoleEntry {
  readonly slug: RoleSlug;
  readonly label: string;
  readonly department: Department;
  /** System roles (boss, hr, managers) have no workstation and see all MCP tools. */
  readonly isSystem: boolean;
}

export const ROLE_REGISTRY: readonly RoleEntry[] = [
  // System / management
  { slug: 'boss', label: 'Boss', department: 'product', isSystem: true },
  { slug: 'hr', label: 'HR', department: 'product', isSystem: true },
  { slug: 'manager', label: 'Team Manager', department: 'product', isSystem: true },
  { slug: 'product_manager', label: 'Product Manager', department: 'product', isSystem: true },
  { slug: 'project_manager', label: 'Project Manager', department: 'product', isSystem: true },
  { slug: 'account_manager', label: 'Account Manager', department: 'product', isSystem: true },
  {
    slug: 'engineering_manager',
    label: 'Engineering Manager',
    department: 'product',
    isSystem: true,
  },
  { slug: 'yolo_master', label: 'YOLO Master', department: 'dev', isSystem: false },
  // Dev
  { slug: 'developer', label: 'Developer', department: 'dev', isSystem: false },
  { slug: 'engineer', label: 'Engineer', department: 'dev', isSystem: false },
  { slug: 'backend', label: 'Backend Dev', department: 'dev', isSystem: false },
  { slug: 'frontend', label: 'Frontend Dev', department: 'dev', isSystem: false },
  { slug: 'fullstack', label: 'Fullstack Dev', department: 'dev', isSystem: false },
  { slug: 'data_engineer', label: 'Data Engineer', department: 'dev', isSystem: false },
  { slug: 'devops', label: 'DevOps', department: 'dev', isSystem: false },
  // Art
  { slug: 'designer', label: 'Designer', department: 'art', isSystem: false },
  { slug: 'artist', label: 'Artist', department: 'art', isSystem: false },
  { slug: 'ui_designer', label: 'UI Designer', department: 'art', isSystem: false },
  { slug: 'ux_designer', label: 'UX Designer', department: 'art', isSystem: false },
  { slug: 'graphic_designer', label: 'Graphic Designer', department: 'art', isSystem: false },
  // Content
  { slug: 'writer', label: 'Writer', department: 'content', isSystem: false },
  { slug: 'marketer', label: 'Marketer', department: 'content', isSystem: false },
  { slug: 'seo_specialist', label: 'SEO Specialist', department: 'content', isSystem: false },
  // Analysis / Product
  { slug: 'pm', label: 'PM', department: 'product', isSystem: false },
  { slug: 'analyst', label: 'Analyst', department: 'product', isSystem: false },
  { slug: 'researcher', label: 'Researcher', department: 'product', isSystem: false },
  { slug: 'qa', label: 'QA', department: 'product', isSystem: false },
] as const;

// ── Derived lookups (consumers use these, never maintain their own) ──

export const ROLE_TO_DEPARTMENT: ReadonlyMap<RoleSlug, Department> = new Map(
  ROLE_REGISTRY.map((r) => [r.slug, r.department]),
);

export const SYSTEM_ROLES: ReadonlySet<RoleSlug> = new Set(
  ROLE_REGISTRY.filter((r) => r.isSystem).map((r) => r.slug),
);

export const ROLE_LABELS: ReadonlyMap<RoleSlug, string> = new Map(
  ROLE_REGISTRY.map((r) => [r.slug, r.label]),
);
