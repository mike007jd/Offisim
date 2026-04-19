import { SkillAssetError, type SkillMetadata, type SkillRow } from '@offisim/shared-types';
import type { EmployeeRepository, RuntimeRepositories, SkillRepository } from '../runtime/repositories.js';
import { createStubVaultFs, type VaultFileSystem } from '../vault/fs.js';
import { employeeSlug } from '../vault/slug.js';
import { parseSkillMd } from './skill-md.js';
import { resolveSkillPath } from './skill-path.js';

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
   * Materialize a company-scope skill from a marketplace install. Contract:
   *   - Idempotent on `listingId`: a prior install of the same listing into
   *     the same company returns the existing row (no dup SKILL.md write).
   *   - Rejects slug collision with an existing company-scope row that was
   *     NOT the same listing install (caller surfaces the error).
   *   - Writes SKILL.md to the company vault path, then inserts the `skills`
   *     row. Vault write failures bubble up (no partial row left behind).
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
    const now = args.now ?? (() => Date.now());
    const existingBySlug = await this.skills.findBySlug(args.companyId, null, args.slug);
    if (existingBySlug) {
      if (existingBySlug.source_ref === args.listingId) {
        return { row: existingBySlug, wasExisting: true };
      }
      throw new Error(
        `Slug "${args.slug}" already exists in company ${args.companyId} (different source). ` +
          'Rename the skill or uninstall the existing one first.',
      );
    }

    const paths = resolveSkillPath({
      companyId: args.companyId,
      scope: 'company',
      skillSlug: args.slug,
    });
    await this.fs.writeFile(paths.skillMdPath, args.skillMd);

    const ts = String(now());
    const row: SkillRow = {
      skill_id: args.skillId,
      company_id: args.companyId,
      employee_id: null,
      scope: 'company',
      slug: args.slug,
      name: args.name,
      description: args.description,
      version: args.version,
      source_kind: 'installed',
      source_ref: args.listingId,
      vault_path: paths.skillMdPath,
      created_at: ts,
      updated_at: ts,
    };
    await this.skills.insert(row);
    return { row, wasExisting: false };
  }
}
