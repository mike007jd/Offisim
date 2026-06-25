/**
 * P0 builtin Mission evaluators (PRD §20.2, slice MS-003).
 *
 * Each evaluator is PURE logic over the injected {@link EvaluationContext}: it
 * reads its declarative config from `JSON.parse(ctx.criterion.configJson)` and
 * uses ONLY the injected capabilities — never node `fs` / `child_process` /
 * `git` (the §14.2 / §20.3 security boundary). Every one is `deterministic: true`
 * EXCEPT {@link llmRubricReview}.
 *
 * Verdict conventions (shared across evaluators):
 *   - PASS    — the acceptance check is satisfied.
 *   - FAIL    — the check ran and the criterion is not met. Deterministic FAIL is
 *               final; no later LLM PASS may override it (§5, §20.3).
 *   - ERROR   — the check could not be run as intended (malformed config, a
 *               classifier-blocked command, an unparseable JSON file). ERROR is
 *               distinct from FAIL so the loop controller does not treat a setup
 *               problem as a real acceptance failure.
 *   - BLOCKED — waiting on an external input (a human approval not yet recorded).
 *   - SKIP    — intentionally not gated (the advisory-only LLM reviewer).
 *
 * Additive at MS-003 — nothing consumes these yet (MS-004 loop controller).
 */

import { globToRegexPath } from '../../../utils/glob-match.js';
import type { EvaluationContext, EvaluationResult, MissionEvaluator } from './types.js';

const VERSION = '1.0.0';

/** Parse the criterion config; throws a tagged error on malformed JSON. */
function parseConfig<T>(ctx: EvaluationContext): T {
  try {
    return JSON.parse(ctx.criterion.configJson || '{}') as T;
  } catch {
    throw new ConfigParseError();
  }
}

/** Internal: signals an unparseable `evaluator_config_json` (→ ERROR verdict). */
class ConfigParseError extends Error {}

/** Wrap an evaluator body so a malformed config / unexpected throw → ERROR. */
function safeEvaluate(
  run: (ctx: EvaluationContext) => Promise<EvaluationResult>,
): (ctx: EvaluationContext) => Promise<EvaluationResult> {
  return async (ctx) => {
    try {
      return await run(ctx);
    } catch (error) {
      const reason =
        error instanceof ConfigParseError
          ? 'malformed evaluator_config_json'
          : error instanceof Error
            ? error.message
            : String(error);
      return { verdict: 'ERROR', summary: `evaluator could not run: ${reason}`, evidenceRefs: [] };
    }
  };
}

// ---------------------------------------------------------------------------
// command_exit_zero — config { command }. Run it; exit 0 → PASS, else FAIL.
// A classifier-blocked command is ERROR (a setup/policy problem), NOT FAIL.
// ---------------------------------------------------------------------------

const commandExitZero: MissionEvaluator = {
  id: 'command_exit_zero',
  version: VERSION,
  deterministic: true,
  evaluate: safeEvaluate(async (ctx) => {
    const { command } = parseConfig<{ command?: string }>(ctx);
    if (!command) {
      return { verdict: 'ERROR', summary: 'command_exit_zero requires config.command', evidenceRefs: [] };
    }
    const result = await ctx.runCommand(command);
    if (result.classifierBlocked) {
      return {
        verdict: 'ERROR',
        summary: `command blocked by shell classifier: ${command}`,
        evidenceRefs: [`command:${command}`, 'classifier:blocked'],
      };
    }
    const verdict = result.exitCode === 0 ? 'PASS' : 'FAIL';
    return {
      verdict,
      summary: `\`${command}\` exited ${result.exitCode}`,
      evidenceRefs: [`command:${command}`, `exitCode:${result.exitCode}`],
    };
  }),
};

// ---------------------------------------------------------------------------
// file_exists — config { path }. Exists → PASS, else FAIL.
// ---------------------------------------------------------------------------

const fileExists: MissionEvaluator = {
  id: 'file_exists',
  version: VERSION,
  deterministic: true,
  evaluate: safeEvaluate(async (ctx) => {
    const { path } = parseConfig<{ path?: string }>(ctx);
    if (!path) {
      return { verdict: 'ERROR', summary: 'file_exists requires config.path', evidenceRefs: [] };
    }
    const exists = await ctx.workspaceFileExists(path);
    return {
      verdict: exists ? 'PASS' : 'FAIL',
      summary: exists ? `file exists: ${path}` : `file missing: ${path}`,
      evidenceRefs: [`path:${path}`],
    };
  }),
};

// ---------------------------------------------------------------------------
// file_hash — config { path, sha256 }. Match → PASS, mismatch → FAIL,
// absent/out-of-jail → ERROR (cannot be hashed, so cannot be asserted).
// ---------------------------------------------------------------------------

const fileHash: MissionEvaluator = {
  id: 'file_hash',
  version: VERSION,
  deterministic: true,
  evaluate: safeEvaluate(async (ctx) => {
    const { path, sha256 } = parseConfig<{ path?: string; sha256?: string }>(ctx);
    if (!path || !sha256) {
      return {
        verdict: 'ERROR',
        summary: 'file_hash requires config.path and config.sha256',
        evidenceRefs: [],
      };
    }
    const actual = await ctx.workspaceHashFile(path);
    if (actual === null) {
      return {
        verdict: 'ERROR',
        summary: `cannot hash (absent or out-of-jail): ${path}`,
        evidenceRefs: [`path:${path}`],
      };
    }
    const expected = sha256.toLowerCase();
    const match = actual.toLowerCase() === expected;
    return {
      verdict: match ? 'PASS' : 'FAIL',
      summary: match ? `hash matches: ${path}` : `hash mismatch: ${path}`,
      evidenceRefs: [`path:${path}`, `expected:${expected}`, `actual:${actual.toLowerCase()}`],
    };
  }),
};

// ---------------------------------------------------------------------------
// text_contains — config { path, needle }. Includes → PASS, else FAIL.
// Absent file → FAIL (the asserted marker is definitively not present).
// ---------------------------------------------------------------------------

const textContains: MissionEvaluator = {
  id: 'text_contains',
  version: VERSION,
  deterministic: true,
  evaluate: safeEvaluate(async (ctx) => {
    const { path, needle } = parseConfig<{ path?: string; needle?: string }>(ctx);
    if (!path || needle === undefined) {
      return {
        verdict: 'ERROR',
        summary: 'text_contains requires config.path and config.needle',
        evidenceRefs: [],
      };
    }
    const content = await ctx.workspaceReadFile(path);
    if (content === null) {
      return { verdict: 'FAIL', summary: `file missing: ${path}`, evidenceRefs: [`path:${path}`] };
    }
    const found = content.includes(needle);
    return {
      verdict: found ? 'PASS' : 'FAIL',
      summary: found ? `marker present in ${path}` : `marker absent in ${path}`,
      evidenceRefs: [`path:${path}`, `needle:${needle}`],
    };
  }),
};

// ---------------------------------------------------------------------------
// json_schema — config { path, schema }. Parse + minimal structural check.
//
// Supported schema subset (deliberately small — NOT a full JSON-Schema engine):
//   { "type": "object" | "array" | "string" | "number" | "boolean",
//     "required": ["key", ...]   // object only: keys that must be present }
// A `required` list implies an object. Anything beyond this subset is ignored
// (we only assert what we support). File-parse error → ERROR; structurally
// valid → PASS; violates type/required → FAIL.
// ---------------------------------------------------------------------------

type MinimalSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean';
  required?: string[];
};

function jsonTypeOf(value: unknown): MinimalSchema['type'] {
  if (Array.isArray(value)) return 'array';
  if (value === null) return undefined;
  const t = typeof value;
  if (t === 'object' || t === 'string' || t === 'number' || t === 'boolean') return t;
  return undefined;
}

const jsonSchema: MissionEvaluator = {
  id: 'json_schema',
  version: VERSION,
  deterministic: true,
  evaluate: safeEvaluate(async (ctx) => {
    const { path, schema } = parseConfig<{ path?: string; schema?: MinimalSchema }>(ctx);
    if (!path || !schema) {
      return {
        verdict: 'ERROR',
        summary: 'json_schema requires config.path and config.schema',
        evidenceRefs: [],
      };
    }
    const content = await ctx.workspaceReadFile(path);
    if (content === null) {
      return { verdict: 'ERROR', summary: `file missing: ${path}`, evidenceRefs: [`path:${path}`] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        verdict: 'ERROR',
        summary: `invalid JSON: ${path}`,
        evidenceRefs: [`path:${path}`, 'parse:error'],
      };
    }

    // A `required` list implies an object shape even if `type` is omitted.
    const expectedType = schema.type ?? (schema.required ? 'object' : undefined);
    if (expectedType) {
      const actualType = jsonTypeOf(parsed);
      if (actualType !== expectedType) {
        return {
          verdict: 'FAIL',
          summary: `type mismatch in ${path}: expected ${expectedType}, got ${actualType ?? 'null'}`,
          evidenceRefs: [`path:${path}`, `expectedType:${expectedType}`],
        };
      }
    }
    if (schema.required && schema.required.length > 0) {
      const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
        string,
        unknown
      >;
      const missing = schema.required.filter((key) => !Object.hasOwn(obj, key));
      if (missing.length > 0) {
        return {
          verdict: 'FAIL',
          summary: `missing required keys in ${path}: ${missing.join(', ')}`,
          evidenceRefs: [`path:${path}`, `missing:${missing.join(',')}`],
        };
      }
    }
    return { verdict: 'PASS', summary: `JSON valid against schema: ${path}`, evidenceRefs: [`path:${path}`] };
  }),
};

// ---------------------------------------------------------------------------
// artifact_published — config { kind? }. ≥1 artifact (matching kind if given)
// → PASS, else FAIL.
// ---------------------------------------------------------------------------

const artifactPublished: MissionEvaluator = {
  id: 'artifact_published',
  version: VERSION,
  deterministic: true,
  evaluate: safeEvaluate(async (ctx) => {
    const { kind } = parseConfig<{ kind?: string }>(ctx);
    const artifacts = await ctx.listArtifacts();
    const matching = kind ? artifacts.filter((a) => a.kind === kind) : artifacts;
    const ok = matching.length > 0;
    const label = kind ? `kind '${kind}'` : 'any kind';
    return {
      verdict: ok ? 'PASS' : 'FAIL',
      summary: ok
        ? `${matching.length} artifact(s) published (${label})`
        : `no artifact published (${label})`,
      evidenceRefs: matching.map((a) => `artifact:${a.kind}:${a.contentHash}`),
    };
  }),
};

// ---------------------------------------------------------------------------
// git_diff_policy — config { allowedGlobs: string[] }. Every changed path must
// match an allowed glob → PASS, else FAIL (reporting the offending paths).
// Reuses the shared globToRegex matcher (do NOT hand-roll glob).
// ---------------------------------------------------------------------------

const gitDiffPolicy: MissionEvaluator = {
  id: 'git_diff_policy',
  version: VERSION,
  deterministic: true,
  evaluate: safeEvaluate(async (ctx) => {
    const { allowedGlobs } = parseConfig<{ allowedGlobs?: string[] }>(ctx);
    if (!Array.isArray(allowedGlobs)) {
      return {
        verdict: 'ERROR',
        summary: 'git_diff_policy requires config.allowedGlobs: string[]',
        evidenceRefs: [],
      };
    }
    const changed = await ctx.gitChangedPaths();
    // Path globs MUST be segment-aware: a single `*` is one directory level
    // (`docs/*.md` allows `docs/foo.md`, NOT `docs/sub/foo.md`); `**` crosses
    // segments. Using the greedy globToRegex here would silently widen the gate.
    const matchers = allowedGlobs.map((g) => globToRegexPath(g, { caseSensitive: true }));
    const offending = changed.filter((path) => !matchers.some((re) => re.test(path)));
    const ok = offending.length === 0;
    return {
      verdict: ok ? 'PASS' : 'FAIL',
      summary: ok
        ? `all ${changed.length} changed path(s) within policy`
        : `${offending.length} path(s) outside policy: ${offending.join(', ')}`,
      evidenceRefs: ok
        ? [`changed:${changed.length}`, `allowed:${allowedGlobs.join(',')}`]
        : offending.map((p) => `offending:${p}`),
    };
  }),
};

// ---------------------------------------------------------------------------
// manual_approval — config {} (none). null → BLOCKED (awaiting), approved →
// PASS, rejected → FAIL. Deterministic: the verdict is a pure function of the
// recorded approval row, not of any model judgment.
// ---------------------------------------------------------------------------

const manualApproval: MissionEvaluator = {
  id: 'manual_approval',
  version: VERSION,
  deterministic: true,
  evaluate: safeEvaluate(async (ctx) => {
    const approval = await ctx.recordedApproval();
    if (approval === null) {
      return { verdict: 'BLOCKED', summary: 'awaiting human approval', evidenceRefs: [] };
    }
    const who = approval.approver ? ` by ${approval.approver}` : '';
    return {
      verdict: approval.approved ? 'PASS' : 'FAIL',
      summary: approval.approved ? `approved${who}` : `rejected${who}`,
      evidenceRefs: approval.approver ? [`approver:${approval.approver}`] : [],
    };
  }),
};

// ---------------------------------------------------------------------------
// llm_rubric_review — the ONLY non-deterministic evaluator (deterministic:
// false). Advisory-only: by default it is NEVER a required gate (§20.2). MS-003
// does NOT wire a model — there is no model transport in this slice — so it
// returns SKIP. A deterministic FAIL must never be overridable by an LLM PASS
// (§5, §20.3); flagging this `deterministic: false` is how the loop controller
// (MS-004) will know to treat its verdict as advisory.
// ---------------------------------------------------------------------------

const llmRubricReview: MissionEvaluator = {
  id: 'llm_rubric_review',
  version: VERSION,
  deterministic: false,
  evaluate: async () => ({
    verdict: 'SKIP',
    summary:
      'llm_rubric_review is non-deterministic and not enabled as a gate (PRD §20.2 default: not required)',
    evidenceRefs: [],
  }),
};

/**
 * The P0 evaluator set (PRD §20.2), in declaration order. Seeded into
 * {@link createDefaultEvaluatorRegistry}.
 */
export const BUILTIN_EVALUATORS: readonly MissionEvaluator[] = [
  commandExitZero,
  fileExists,
  fileHash,
  textContains,
  jsonSchema,
  artifactPublished,
  gitDiffPolicy,
  manualApproval,
  llmRubricReview,
];
