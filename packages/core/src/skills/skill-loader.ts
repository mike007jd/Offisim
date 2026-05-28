import {
  SkillAssetError,
  SkillEditError,
  type SkillMetadata,
  type SkillRow,
  type SkillSourceKind,
} from '@offisim/shared-types';
import type {
  EmployeeRepository,
  RuntimeRepositories,
  SkillRepository,
} from '../runtime/repositories.js';
import { generateId } from '../utils/generate-id.js';
import { type VaultFileSystem, createUnavailableVaultFs } from '../vault/fs.js';
import { employeeSlug } from '../vault/slug.js';
import { parseSkillMd, serializeSkillMd } from './skill-md.js';
import { resolveSkillPath } from './skill-path.js';
import { skillSlug } from './skill-slug.js';

const ASSET_SUBTREE_PREFIXES = ['scripts/', 'references/', 'assets/'];

/**
 * Narrow event facade so the skill loader can announce "marketplace install
 * landed" without taking a hard dependency on `@offisim/core` EventBus. The
 * runtime adapter wires this to `market.listing-installed` events; harness /
 * tests can pass a noop or omit the dep.
 */
export interface SkillMarketEventEmitter {
  emitMarketListingInstalled(
    companyId: string,
    listingId: string,
    kind: 'skill',
    extras?: { skillId?: string; packageId?: string; version?: string },
  ): void;
}

export interface SkillLoaderDeps {
  skills: SkillRepository;
  employees: EmployeeRepository;
  fs: VaultFileSystem;
  events?: SkillMarketEventEmitter;
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
export interface SkillInstallSourceFork {
  kind: 'fork';
  parentSkillId: string;
  parentVersion: string;
}
export interface SkillInstallSourceSelfAuthored {
  kind: 'self-authored';
  modelKey: string;
}
export type SkillInstallSource =
  | SkillInstallSourceMarketplace
  | SkillInstallSourceGit
  | SkillInstallSourceUpload
  | SkillInstallSourceClaudeCode
  | SkillInstallSourceCodex
  | SkillInstallSourceFork
  | SkillInstallSourceSelfAuthored;

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

export class SkillScopeError extends Error {
  readonly kind: 'self-authoring-requires-employee-scope';

  constructor(kind: SkillScopeError['kind'], message: string) {
    super(message);
    this.name = 'SkillScopeError';
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
    case 'fork':
      return `company-skill:${source.parentSkillId}@${source.parentVersion}`;
    case 'self-authored':
      return `llm-author:${source.modelKey}`;
  }
}

function sourceKindForInsert(source: SkillInstallSource): SkillSourceKind {
  if (source.kind === 'self-authored') return 'self-authored';
  return source.kind === 'fork' ? 'forked' : 'installed';
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
  private readonly events: SkillMarketEventEmitter | undefined;
  private fs: VaultFileSystem;

  constructor(deps: SkillLoaderDeps) {
    this.skills = deps.skills;
    this.employees = deps.employees;
    this.fs = deps.fs;
    this.events = deps.events;
  }

  /**
   * Build a `SkillLoader` from the shared repositories bundle, falling back to
   * an unavailable fs until the vault activates. Returns `null` when the repos
   * bundle lacks the skills table (backwards-compat / lite runtime scenarios).
   */
  static forRepos(
    repos: RuntimeRepositories,
    events?: SkillMarketEventEmitter,
  ): SkillLoader | null {
    if (!repos.skills) return null;
    return new SkillLoader({
      skills: repos.skills,
      employees: repos.employees,
      fs: createUnavailableVaultFs('Vault not activated yet'),
      ...(events !== undefined ? { events } : {}),
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
   * Bulk-read a skill directory. Used by `fork_skill` to snapshot the parent
   * so the staged copy can land byte-identically in the employee bucket.
   * Returns SKILL.md text + every file under `scripts/` / `references/` /
   * `assets/` (recursive) as UTF-8 strings. Missing subtrees are skipped.
   */
  async readSkillDirectory(skillId: string): Promise<{
    row: SkillRow;
    skillMd: string;
    assets: Array<{ relPath: string; content: string }>;
  }> {
    const row = await this.skills.findById(skillId);
    if (!row) {
      throw new SkillAssetError('not-found', `Skill ${skillId} not found`, 'SKILL.md');
    }
    const skillMd = await this.fs.readFile(row.vault_path);
    const skillDir = row.vault_path.replace(/\/SKILL\.md$/u, '');
    const assets: Array<{ relPath: string; content: string }> = [];
    for (const subtree of ASSET_SUBTREE_PREFIXES) {
      // Strip trailing `/` for listDir.
      const subRel = subtree.replace(/\/$/u, '');
      const subAbs = `${skillDir}/${subRel}`;
      if (!(await this.fs.exists(subAbs))) continue;
      await walkVaultSubtree(this.fs, subAbs, subRel, assets);
    }
    return { row, skillMd, assets };
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
    if (args.scope === 'company' && args.source.kind === 'fork') {
      throw new SkillInstallError(
        'scope-target-conflict',
        'installSkill: source.kind="fork" requires scope="employee"',
      );
    }
    if (args.scope === 'company' && args.source.kind === 'self-authored') {
      throw new SkillScopeError(
        'self-authoring-requires-employee-scope',
        'installSkill: self-authored skills require scope="employee"',
      );
    }

    const assets = args.files.assets ?? [];
    for (const asset of assets) {
      validateAssetPath(asset.relPath);
    }

    const skillId = args.skillId ?? generateId('sk');
    const slug = args.slug ?? skillSlug(args.name, skillId);
    const sourceRef = encodeSkillSourceRef(args.source);

    const scopeEmployeeId: string | null =
      args.scope === 'employee' ? (args.employeeId ?? null) : null;

    const existingBySlug = await this.skills.findBySlug(args.companyId, scopeEmployeeId, slug);
    if (existingBySlug) {
      if (existingBySlug.source_ref === sourceRef) {
        return { row: existingBySlug, wasExisting: true };
      }
      throw new SkillInstallError(
        'slug-collision',
        `Skill slug "${slug}" already exists in company ${args.companyId} (${args.scope} scope) from a different source. Rename or uninstall the existing skill first.`,
      );
    }

    let empSlug: string | undefined;
    if (args.scope === 'employee') {
      if (!scopeEmployeeId) {
        throw new SkillInstallError(
          'missing-target-employee',
          'installSkill: scope="employee" requires employeeId',
        );
      }
      const employee = await this.employees.findById(scopeEmployeeId);
      if (!employee) {
        throw new SkillInstallError(
          'target-employee-not-found',
          `installSkill: employeeId ${scopeEmployeeId} not found`,
        );
      }
      if (employee.company_id !== args.companyId) {
        throw new SkillInstallError(
          'target-employee-not-found',
          `installSkill: employeeId ${scopeEmployeeId} does not belong to company ${args.companyId}`,
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
      source_kind: sourceKindForInsert(args.source),
      source_ref: sourceRef,
      vault_path: paths.skillMdPath,
      created_at: ts,
      updated_at: ts,
    };

    // FS-after-DB: insert the row first so a mid-write crash leaves an orphan
    // DB row pointing at a missing vault file. That's observable through
    // `listSkillsForEmployee` + a subsequent `loadSkillBody` ENOENT, and the
    // user can clean it from the Skills UI. The previous order (FS first) left
    // orphan vault files with no DB anchor, which were invisible.
    await this.skills.insert(row);

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

      // Only marketplace installs surface to the Market UI's installed-state
      // signal — git / upload / fork / claude-code / codex / self-authored
      // sources have no listing to map to. Emit happens after FS+DB are
      // consistent so subscribers can trust the DB row matches the vault.
      if (args.source.kind === 'marketplace' && this.events) {
        this.events.emitMarketListingInstalled(args.companyId, args.source.listingId, 'skill', {
          skillId: row.skill_id,
          version: row.version,
        });
      }
      return { row, wasExisting: false };
    } catch (err) {
      // Compensating rollback: unlink any partial FS writes, then delete the
      // DB row. Best-effort — if any step fails we still surface the original
      // error to the caller.
      for (const written of writtenPaths.reverse()) {
        try {
          await this.fs.remove(written);
        } catch {
          /* best-effort rollback */
        }
      }
      try {
        await this.skills.delete(row.skill_id);
      } catch {
        /* best-effort rollback — orphan row preferred over hiding the error */
      }
      throw err;
    }
  }

  /**
   * Rewrite an existing skill's SKILL.md body without touching identity fields
   * (slug / scope / source_kind / source_ref / vault_path). Frontmatter is
   * preserved byte-equivalently via `serializeSkillMd`; only the body + DB
   * `version` (patch bump) + `updated_at` change.
   *
   * Defence-in-depth (C/C-11): callers SHOULD supply `expectedCompanyId` so
   * the loader refuses to overwrite a skill that doesn't live in the active
   * company's vault. Calls without `expectedCompanyId` continue to work
   * (preserves the generic-write-API shape used by future T2.5 peer-transfer
   * / T2.6 self-improve), but those callers must keep doing their own scope
   * gate at the staging layer.
   */
  async editSkillBody(args: {
    skillId: string;
    newBody: string;
    expectedCompanyId?: string;
    expectedEmployeeId?: string | null;
    now?: () => number;
  }): Promise<{ row: SkillRow }> {
    const now = args.now ?? (() => Date.now());
    const row = await this.skills.findById(args.skillId);
    if (!row) {
      throw new SkillEditError(
        'skill-not-found',
        `editSkillBody: skill ${args.skillId} not found`,
        args.skillId,
      );
    }

    if (args.expectedCompanyId !== undefined && row.company_id !== args.expectedCompanyId) {
      throw new SkillEditError(
        'skill-not-found',
        `editSkillBody: skill ${args.skillId} does not belong to company ${args.expectedCompanyId}`,
        args.skillId,
      );
    }
    if (
      args.expectedEmployeeId !== undefined &&
      (row.employee_id ?? null) !== (args.expectedEmployeeId ?? null)
    ) {
      throw new SkillEditError(
        'skill-not-found',
        `editSkillBody: skill ${args.skillId} does not belong to employee ${args.expectedEmployeeId ?? '(company-scope)'}`,
        args.skillId,
      );
    }

    let parsed: ReturnType<typeof parseSkillMd>;
    try {
      const raw = await this.fs.readFile(row.vault_path);
      parsed = parseSkillMd(raw);
    } catch (err) {
      throw new SkillEditError(
        'skill-md-invalid',
        `editSkillBody: SKILL.md at ${row.vault_path} could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
        args.skillId,
      );
    }

    const nextVersion = bumpPatch(row.version);
    if (nextVersion === null) {
      throw new SkillEditError(
        'version-bump-failed',
        `editSkillBody: version "${row.version}" is not semver-patch-bumpable`,
        args.skillId,
      );
    }

    const serialized = serializeSkillMd({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.allowedTools !== undefined ? { allowedTools: parsed.allowedTools } : {}),
      ...(parsed.license !== undefined ? { license: parsed.license } : {}),
      // Preserve the row's version so the frontmatter doesn't drift out of
      // sync with the DB; the patch bump below is authoritative.
      version: nextVersion,
      body: args.newBody,
    });
    await this.fs.writeFile(row.vault_path, serialized);

    const ts = String(now());
    await this.skills.update(row.skill_id, {
      version: nextVersion,
      updated_at: ts,
    });
    return {
      row: { ...row, version: nextVersion, updated_at: ts },
    };
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

async function walkVaultSubtree(
  fs: VaultFileSystem,
  dirAbs: string,
  relPrefix: string,
  out: Array<{ relPath: string; content: string }>,
): Promise<void> {
  const entries = await fs.listDir(dirAbs);
  for (const entry of entries) {
    const childAbs = `${dirAbs}/${entry}`;
    const childRel = `${relPrefix}/${entry}`;
    // listDir returns names only (no stat). Try read as file first; if it
    // fails (likely a directory), recurse.
    try {
      const text = await fs.readFile(childAbs);
      out.push({ relPath: childRel, content: text });
    } catch {
      // Assume directory — recurse. If `listDir` fails too, swallow since the
      // caller is best-effort (missing subtree is fine).
      try {
        await walkVaultSubtree(fs, childAbs, childRel, out);
      } catch {
        /* non-fatal: unreadable node */
      }
    }
  }
}

/**
 * Semver-safe patch bump. Accepts `major.minor.patch` where each segment is a
 * non-negative integer; rejects prerelease suffixes (`1.0.0-beta`), build
 * metadata (`1.0.0+sha`), non-numeric segments, or anything else. Returns
 * `null` on reject so `editSkillBody` can surface a structured error.
 */
export function bumpPatch(version: string): string | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null;
  }
  return `${major}.${minor}.${patch + 1}`;
}
