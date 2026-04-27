import type { SkillInstallSource } from './skill-loader.js';
import type { ScannedSkill, VirtualTree } from './skill-source-resolvers/types.js';

export interface StagedSkillBase {
  stagingRef: string;
  /** Epoch-ms when this entry was created. */
  createdAt: number;
  /** Epoch-ms after which the entry is evicted. */
  expiresAt: number;
  /** Desktop-only: git tmp clone path the caller should cleanup. */
  tmpPath?: string | undefined;
  /** Optional cleanup hook (e.g. rm tmp dir); invoked on expiry or explicit release. */
  cleanup?: (() => Promise<void>) | undefined;
  /** Company + scope the mutation will land in (LLM-resolved). */
  companyId: string;
}

export interface StagedSkillInstall extends StagedSkillBase {
  /**
   * `'install'` for the four T2.2 import tools; `'fork'` for a company-scope
   * skill being copied into an employee bucket; `'create'` for LLM-authored
   * employee-scope skills. All share the install-tree shape.
   */
  action: 'install' | 'fork' | 'create';
  /** Virtual tree captured from a resolver; asset bytes live here. */
  tree: VirtualTree;
  /** Scanner output locating SKILL.md + asset paths relative to `tree`. */
  scan: ScannedSkill;
  /** Parsed skill metadata (name / description / allowedTools). */
  name: string;
  description: string;
  allowedTools: readonly string[];
  /** Full SKILL.md text (frontmatter + body) — preview bubble renders this. */
  skillMdText: string;
  source: SkillInstallSource;
  scope: 'company' | 'employee';
  employeeId: string | null;
}

export interface StagedSkillEdit extends StagedSkillBase {
  action: 'edit';
  /** `skills.skill_id` of the row whose SKILL.md body is being rewritten. */
  skillId: string;
  /** New SKILL.md body (frontmatter preserved — never included here). */
  newBody: string;
  /** Resolved employee owner (always scope='employee'). */
  employeeId: string;
}

export type StagedSkill = StagedSkillInstall | StagedSkillEdit;

export interface SkillStagingManagerOpts {
  ttlMs?: number;
  now?: () => number;
  /** Used for Node/bun. In tests you can pass a stub. */
  setInterval?: (fn: () => void, ms: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval?: (handle: ReturnType<typeof globalThis.setInterval>) => void;
  idFactory?: () => string;
}

/**
 * Process-local staging store for skill installs pending user confirmation.
 * The tool handler calls `put()` after a resolver returns a valid tree; the
 * interaction-response handler calls `take()` when the user confirms. Expired
 * entries are swept by a lightweight interval (default every minute) so the
 * `confirm` path can return `staging-expired` promptly instead of racing.
 */
export class SkillStagingManager {
  private readonly store = new Map<string, StagedSkill>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly gcHandle: unknown;
  private readonly clearIntervalFn: (h: unknown) => void;

  constructor(opts: SkillStagingManagerOpts = {}) {
    this.ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
    this.idFactory =
      opts.idFactory ?? (() => `stg_${this.now()}_${Math.random().toString(36).slice(2, 10)}`);
    const setIv = (opts.setInterval ?? globalThis.setInterval.bind(globalThis)) as (
      fn: () => void,
      ms: number,
    ) => unknown;
    this.clearIntervalFn = (opts.clearInterval ?? globalThis.clearInterval.bind(globalThis)) as (
      h: unknown,
    ) => void;
    this.gcHandle = setIv(() => {
      void this.sweep();
    }, 60_000);
    const maybeHandle = this.gcHandle as { unref?: () => void } | null;
    if (maybeHandle && typeof maybeHandle.unref === 'function') {
      maybeHandle.unref();
    }
  }

  /**
   * Distributive over the `StagedSkill` union — each variant's non-base fields
   * are preserved when the caller narrows via `entry.action`.
   */
  put<T extends StagedSkill>(
    entry: T extends unknown ? Omit<T, 'stagingRef' | 'createdAt' | 'expiresAt'> : never,
  ): T {
    const stagingRef = this.idFactory();
    const createdAt = this.now();
    const staged = {
      ...entry,
      stagingRef,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    } as unknown as T;
    this.store.set(stagingRef, staged);
    return staged;
  }

  peek(stagingRef: string): StagedSkill | null {
    const entry = this.store.get(stagingRef);
    if (!entry) return null;
    if (entry.expiresAt < this.now()) {
      void this.release(stagingRef);
      return null;
    }
    return entry;
  }

  async take(stagingRef: string): Promise<StagedSkill | null> {
    const entry = this.peek(stagingRef);
    if (!entry) return null;
    this.store.delete(stagingRef);
    return entry;
  }

  async release(stagingRef: string): Promise<void> {
    const entry = this.store.get(stagingRef);
    if (!entry) return;
    this.store.delete(stagingRef);
    if (entry.cleanup) {
      try {
        await entry.cleanup();
      } catch {
        /* best-effort */
      }
    }
  }

  async sweep(): Promise<void> {
    const cutoff = this.now();
    const expired: string[] = [];
    for (const [ref, entry] of this.store) {
      if (entry.expiresAt < cutoff) expired.push(ref);
    }
    for (const ref of expired) {
      await this.release(ref);
    }
  }

  dispose(): void {
    this.clearIntervalFn(this.gcHandle);
  }
}
