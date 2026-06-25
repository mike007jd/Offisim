/**
 * Mission Evaluator contracts (PRD §20.1, slice MS-003).
 *
 * Evaluators are the EXTERNAL acceptance check for a Mission criterion (PRD §5:
 * a root agent's "I'm done" is never the sole basis for a Mission PASS). They are
 * PURE logic over an INJECTED {@link EvaluationContext} — they never touch node
 * `fs` / `child_process` / `git` directly. That is the §14.2 / §20.3 / §28
 * security boundary:
 *
 *   - In production the capabilities are backed by the sandboxed Tauri commands
 *     (Rust path-jail, shell classifier, timeout, output cap, redaction). The
 *     renderer must NOT directly execute workspace files / shell / git (§14.2.2).
 *   - In the harness the capabilities are in-memory test doubles over a fixture
 *     map, so the deterministic logic is fully testable without a real workspace.
 *
 * A deterministic FAIL is final: it must never be overridable by a later LLM PASS
 * (§5, §20.3). `llm_rubric_review` is the ONLY non-deterministic evaluator and
 * must be flagged `deterministic: false`; by default it is advisory-only and is
 * never a required gate.
 *
 * Additive at MS-003 — nothing consumes evaluators yet (the loop controller that
 * runs them is MS-004).
 */

import type { MissionEvaluationVerdict } from '@offisim/shared-types';

/**
 * Evaluator verdict. Re-exported from the shared-types domain union so the core
 * evaluator layer and the §17.4 `MissionEvaluation` row speak the same
 * vocabulary (PASS | FAIL | BLOCKED | ERROR | SKIP).
 */
export type EvaluationVerdict = MissionEvaluationVerdict;

/** The outcome of evaluating a single criterion. */
export interface EvaluationResult {
  verdict: EvaluationVerdict;
  /** Human-readable one-liner; persisted to `mission_evaluation.summary`. */
  summary: string;
  /**
   * Opaque evidence pointers (command ref, file path, artifact hash, etc.).
   * Persisted to `mission_evaluation.evidence_refs_json`. Never raw secrets —
   * the command capability is already redacted by the provider.
   */
  evidenceRefs: string[];
}

/**
 * The capability surface an evaluator is given. In production every method is
 * backed by a sandboxed Tauri command; in the harness they are in-memory.
 *
 * Design rule (the security boundary): evaluators read state ONLY through these
 * methods. They never construct their own fs/shell/git access. A capability that
 * cannot serve a request (absent file, out-of-jail path, classifier block)
 * returns a safe sentinel (`null` / `false` / `classifierBlocked: true`) rather
 * than throwing, so an evaluator maps it to a verdict instead of crashing.
 */
export interface EvaluationContext {
  /** The criterion under evaluation. `configJson` is the declarative
   *  `evaluator_config_json` (§17.2); each evaluator parses its own shape. */
  readonly criterion: {
    readonly id: string;
    readonly description: string;
    readonly configJson: string;
  };

  // -- Injected capabilities (production = Tauri-sandboxed; harness = in-memory):

  /** Read a workspace file as UTF-8. `null` if absent or out-of-jail. */
  workspaceReadFile(path: string): Promise<string | null>;
  /** Whether a workspace file exists (and is in-jail). */
  workspaceFileExists(path: string): Promise<boolean>;
  /** sha256 hex of a workspace file, or `null` if absent / out-of-jail. */
  workspaceHashFile(path: string): Promise<string | null>;
  /**
   * Run a command. The provider has ALREADY applied the shell classifier,
   * workspace jail, timeout, output cap, and redaction (§20.3). A
   * classifier-blocked command resolves with `classifierBlocked: true` (the
   * evaluator must treat that as ERROR, not FAIL — see {@link MissionEvaluator}).
   */
  runCommand(
    command: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string; classifierBlocked?: boolean }>;
  /**
   * Paths changed in the working tree, relative to the workspace root.
   *
   * The empty array and a capability failure are DISTINCT outcomes and must not
   * be conflated (a `[]`-means-clean read would make a `git_diff_policy`
   * criterion falsely PASS when git is simply unavailable):
   *   - `null`        → the capability could NOT serve the request (no bound
   *                     project, git unavailable, or a non-git workspace). The
   *                     evaluator maps this to ERROR — the diff is unknowable,
   *                     never "clean".
   *   - `[]`          → the read SUCCEEDED and the working tree is genuinely
   *                     clean (no changes). This is a real PASS for a policy gate.
   *   - non-empty arr → the read succeeded and these paths changed.
   *
   * Scope note: this reflects only UNCOMMITTED working-tree changes (the known
   * boundary). A committed-baseline diff is Tier C, out of scope here.
   */
  gitChangedPaths(): Promise<string[] | null>;
  /** Artifacts published for this mission/attempt. */
  listArtifacts(): Promise<Array<{ kind: string; title: string; contentHash: string }>>;
  /**
   * The recorded human approval for a `manual_approval` criterion, or `null`
   * when none has been recorded yet (the evaluator maps `null` → BLOCKED).
   */
  recordedApproval(): Promise<{ approved: boolean; approver?: string } | null>;
}

/**
 * A registered evaluator (PRD §20.1). `deterministic` is part of the contract:
 * a `false` evaluator's verdict is advisory and may never override a
 * deterministic FAIL (§5, §20.3). `version` lets a Playbook pin a behavior.
 */
export interface MissionEvaluator {
  readonly id: string;
  readonly version: string;
  readonly deterministic: boolean;
  evaluate(ctx: EvaluationContext): Promise<EvaluationResult>;
}
