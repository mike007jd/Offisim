import { SkillAssetError, type SkillMetadata, type SkillRow } from '@offisim/shared-types';
import type {
  EmployeeRepository,
  RuntimeRepositories,
  SkillRepository,
} from '../runtime/repositories.js';
import { type VaultFileSystem, createStubVaultFs } from '../vault/fs.js';
import { employeeSlug } from '../vault/slug.js';
import { parseSkillMd } from './skill-md.js';
import { resolveSkillPath } from './skill-path.js';
import { skillSlug } from './skill-slug.js';

const ASSET_SUBTREE_PREFIXES = ['scripts/', 'references/', 'assets/'];

export interface SkillLoaderDeps {
  skills: SkillRepository;
  employees: EmployeeRepository;
  fs: VaultFileSystem;
}

function rowToMetadata(row: SkillRow): SkillMetadata {
  return {
    id: row.skill_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    scope: row.scope,
    version: row.version,
  };
}

/**
 * Union of install source shapes accepted by `installSkill`. Marketplace is
 * reserved for the `installCompanyScopeSkill` wrapper (source_ref = listingId
 * for backward-compat idempotency); every other source encodes its provenance
 * as a prefixed `source_ref` string the UI and future dedupe can parse.
 */
export interface SkillInstallSourceMarketplace {
  kind: 'marketplace';
  listingId: string;
}
export interface SkillInstallSourceGit {
  kind: 'git';
  url: string;
  ref?: string | undefined;
  /** Repo-relative subdirectory containing SKILL.md (monorepo support). */
  subpath?: string | undefined;
}
export interface SkillInstallSourceUpload {
  kind: 'upload';
  filename: string;
  /** Archive-relative subdirectory containing SKILL.md. */
  subpath?: string | undefined;
}
export interface SkillInstallSourceClaudeCode {
  kind: 'claude-code';
  path: string;
}
export interface SkillInstallSourceCodex {
  kind: 'codex';
  path: string;
}
export type SkillInstallSource =
  | SkillInstallSourceMarketplace
  | SkillInstallSourceGit
  | SkillInstallSourceUpload
  | SkillInstallSourceClaudeCode
  | SkillInstallSourceCodex;

export interface SkillInstallAsset {
  relPath: string;
  content: Uint8Array | string;
}

export interface InstallSkillArgs {
  scope: 'company' | 'employee';
  companyId: string;
  employeeId?: string | undefined;
  slug?: string | undefined;
  name: string;
  description: string;
  version?: string | undefined;
  source: SkillInstallSource;
  files: {
    skillMd: string;
    assets?: SkillInstallAsset[] | undefined;
  };
  skillId?: string | undefined;
  now?: (() => number) | undefined;
}

export interface InstallSkillResult {
  row: SkillRow;
  wasExisting: boolean;
}

export class SkillInstallError extends Error {
  readonly kind:
    | 'scope-target-conflict'
    | 'missing-target-employee'
    | 'target-employee-not-found'
    | 'slug-collision';
  constructor(kind: SkillInstallError['kind'], message: string) {
    super(message);
    this.name = 'SkillInstallError';
    this.kind = kind;
  }
}

export function encodeSkillSourceRef(source: SkillInstallSource): string {
  switch (source.kind) {
    case 'marketplace':
      return source.listingId;
    case 'git': {
      const base = source.ref ? `git:${source.url}@${source.ref}` : `git:${source.url}`;
      return source.subpath ? `${base}#${source.subpath}` : base;
    }
    case 'upload': {
      const base = `upload:${source.filename}`;
      return source.subpath ? `${base}#${source.subpath}` : base;
    }
    case 'claude-code':
      return `claude-code:${source.path}`;
    case 'codex':
      return `codex:${source.path}`;
  }
}

function validateAssetPath(relPath: string): void {
  if (relPath.includes('..')) {
    throw new SkillAssetError(
      'path-traversal',
      `Skill asset path "${relPath}" contains parent-directory segments`,
      relPath,
    );
  }
  if (relPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relPath)) {
    throw new SkillAssetError(
      'absolute-path-forbidden',
      `Skill asset path "${relPath}" must be a relative path`,
      relPath,
    );
  }
  if (!ASSET_SUBTREE_PREFIXES.some((p) => relPath.startsWith(p))) {
    throw new SkillAssetError(
      'subtree-forbidden',
      `Skill asset path "${relPath}" must start with scripts/, references/, or assets/`,
      relPath,
    );
  }
}

/**
 * Progressive-disclosure skill loader.
 *
 * - Tier 1 — listing (sync-shaped, DB-only): `listSkillsForEmployee`
 * - Tier 2 — activation (async, reads SKILL.md body): `loadSkillBody`
 * - Tier 3 — on-demand (async, reads a whitelisted asset): `loadSkillAsset`
 *
 * Tier 3 rejects `..`, absolute paths, and anything outside the
 * `scripts/` / `references/` / `assets/` subtrees before doing any IO.
 */
export class SkillLoader {
  private readonly skills: SkillRepository;
  private readonly employees: EmployeeRepository;
  private fs: VaultFileSystem;

  constructor(deps: SkillLoaderDeps) {
    this.skills = deps.skills;
    this.employees = deps.employees;
    this.fs = deps.fs;
  }

  /**
   * Build a `SkillLoader` from the shared repositories bundle, falling back to
   * a stub fs until the vault activates. Returns `null` when the repos bundle
   * lacks the skills table (backwards-compat / lite runtime scenarios).
   */
  static forRepos(repos: RuntimeRepositories): SkillLoader | null {
    if (!repos.skills) return null;
    return new SkillLoader({
      skills: repos.skills,
      employees: repos.employees,
      fs: createStubVaultFs('Vault not activated yet'),
    });
  }

  /**
   * Swap the underlying filesystem. Callers use this when the vault becomes
   * available after an async activation step (user mounts a directory /
   * Tauri appDataDir resolves) — tier-2/3 reads start succeeding without
   * reconstructing the loader or its UI subscribers.
   */
  setFs(fs: VaultFileSystem): void {
    this.fs = fs;
  }

  async listSkillsForEmployee(companyId: string, employeeId: string): Promise<SkillMetadata[]> {
    const [companyRows, employeeRows] = await Promise.all([
      this.skills.listByCompanyScope(companyId),
      this.skills.listByEmployee(companyId, employeeId),
    ]);
    const bySlug = new Map<string, SkillRow>();
    for (const row of employeeRows) {
      bySlug.set(row.slug, row);
    }
    for (const row of companyRows) {
      if (!bySlug.has(row.slug)) bySlug.set(row.slug, row);
    }
    return [...bySlug.values()].map(rowToMetadata);
  }

  async loadSkillBody(skillId: string): Promise<string> {
    const row = await this.skills.findById(skillId);
    if (!row) {
      throw new SkillAssetError('not-found', `Skill ${skillId} not found`, 'SKILL.md');
    }
    const raw = await this.fs.readFile(row.vault_path);
    const parsed = parseSkillMd(raw);
    return parsed.body;
  }

  async loadSkillAsset(skillId: string, relPath: string): Promise<string> {
    validateAssetPath(relPath);
    const row = await this.skills.findById(skillId);
    if (!row) {
      throw new SkillAssetError('not-found', `Skill ${skillId} not found`, relPath);
    }
    const skillDir = row.vault_path.replace(/\/SKILL\.md$/u, '');
    return this.fs.readFile(`${skillDir}/${relPath}`);
  }

  /**
   * Resolve the filesystem-safe employee slug for employee-scope skill paths.
   * Used by callers that need to write a new employee-scope skill and don't
   * already have the slug cached.
   */
  async resolveEmployeeSlug(employeeId: string): Promise<string | null> {
    const row = await this.employees.findById(employeeId);
    if (!row) return null;
    return employeeSlug(row.name, row.employee_id);
  }

  /**
   * Unified skill install entry. All skill mutations MUST go through this
   * method so tier-3 guards, slug/source collision, and write-through rollback
   * are enforced in exactly one place.
   *
   * Contract:
   * - Tier-3 guards run on every `files.assets[].relPath` BEFORE any IO.
   * - Slug uniqueness is enforced per-scope via `findBySlug` (partial UNIQUE
   *   indexes back it). Same (company, scope=company, slug) with same
   *   `source_ref` is idempotent (returns existing row). Different source_ref
   *   throws `slug-collision`. Employee-scope is allowed to shadow company-scope.
   * - Write order: SKILL.md → assets → `skills` row. Any failure after the
   *   first successful write rolls back all already-written files before
   *   re-throwing the original error.
   */
  async installSkill(args: InstallSkillArgs): Promise<InstallSkillResult> {
    const now = args.now ?? (() => Date.now());
    if (args.scope === 'employee' && !args.employeeId) {
      throw new SkillInstallError(
        'missing-target-employee',
        'installSkill: scope="employee" requires employeeId',
      );
    }
    if (args.scope === 'company' && args.employeeId) {
      throw new SkillInstallError(
        'scope-target-conflict',
        'installSkill: scope="company" forbids employeeId',
      );
    }

    const assets = args.files.assets ?? [];
    for (const asset of assets) {
      validateAssetPath(asset.relPath);
    }

    const skillId = args.skillId ?? `sk_${now()}_${Math.random().toString(36).slice(2, 10)}`;
    const slug = args.slug ?? skillSlug(args.name, skillId);
    const sourceRef = encodeSkillSourceRef(args.source);

    const scopeEmployeeId: string | null = args.scope === 'employee' ? args.employeeId! : null;

    const existingBySlug = await this.skills.findBySlug(args.companyId, scopeEmployeeId, slug);
    if (existingBySlug) {
      if (existingBySlug.source_ref === sourceRef) {
        return { row: existingBySlug, wasExisting: true };
      }
      throw new SkillInstallError(
        'slug-collision',
        `Skill slug "${slug}" already exists in company ${args.companyId} (${args.scope} scope) ` +
          `from a different source. Rename or uninstall the existing skill first.`,
      );
    }

    let empSlug: string | undefined;
    if (args.scope === 'employee') {
      const employee = await this.employees.findById(args.employeeId!);
      if (!employee) {
        throw new SkillInstallError(
          'target-employee-not-found',
          `installSkill: employeeId ${args.employeeId} not found`,
        );
      }
      if (employee.company_id !== args.companyId) {
        throw new SkillInstallError(
          'target-employee-not-found',
          `installSkill: employeeId ${args.employeeId} does not belong to company ${args.companyId}`,
        );
      }
      empSlug = employeeSlug(employee.name, employee.employee_id);
    }

    const paths = resolveSkillPath({
      companyId: args.companyId,
      scope: args.scope,
      ...(empSlug !== undefined ? { employeeSlug: empSlug } : {}),
      skillSlug: slug,
    });

    const writtenPaths: string[] = [];
    try {
      await this.fs.writeFile(paths.skillMdPath, args.files.skillMd);
      writtenPaths.push(paths.skillMdPath);

      for (const asset of assets) {
        const content =
          typeof asset.content === 'string' ? asset.content : decodeUint8(asset.content);
        const assetPath = paths.assetPathFor(asset.relPath);
        await this.fs.writeFile(assetPath, content);
        writtenPaths.push(assetPath);
      }

      const ts = String(now());
      const row: SkillRow = {
        skill_id: skillId,
        company_id: args.companyId,
        employee_id: scopeEmployeeId,
        scope: args.scope,
        slug,
        name: args.name,
        description: args.description,
        version: args.version ?? '0.1.0',
        source_kind: 'installed',
        source_ref: sourceRef,
        vault_path: paths.skillMdPath,
        created_at: ts,
        updated_at: ts,
      };
      await this.skills.insert(row);
      return { row, wasExisting: false };
    } catch (err) {
      for (const written of writtenPaths.reverse()) {
        try {
          await this.fs.remove(written);
        } catch {
          /* best-effort rollback */
        }
      }
      throw err;
    }
  }

  /**
   * Materialize a company-scope skill from a marketplace install. Thin wrapper
   * over `installSkill({ scope: 'company', source: { kind: 'marketplace', ... } })`.
   * Public signature and semantics — including idempotency on `listingId` —
   * are preserved so marketplace callers need zero changes.
   */
  async installCompanyScopeSkill(args: {
    companyId: string;
    listingId: string;
    name: string;
    slug: string;
    description: string;
    version: string;
    skillMd: string;
    skillId: string;
    now?: () => number;
  }): Promise<{ row: SkillRow; wasExisting: boolean }> {
    return this.installSkill({
      scope: 'company',
      companyId: args.companyId,
      slug: args.slug,
      name: args.name,
      description: args.description,
      version: args.version,
      source: { kind: 'marketplace', listingId: args.listingId },
      files: { skillMd: args.skillMd },
      skillId: args.skillId,
      ...(args.now !== undefined ? { now: args.now } : {}),
    });
  }
}

function decodeUint8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}
