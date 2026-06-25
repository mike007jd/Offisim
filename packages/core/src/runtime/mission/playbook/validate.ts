/**
 * Playbook validator (PRD §25.2, §20.3, §26.2 — slices PB-002 + PB-003).
 *
 * THIS IS THE SAFETY GATE. A {@link MissionPlaybook} is a DECLARATIVE asset
 * distributed through the Marketplace; it must NEVER carry executable or
 * install-time content. `validatePlaybook` is what enforces that: a playbook that
 * passes validation is GUARANTEED to be pure declarative data that references
 * ONLY registered evaluators (MS-003) with declarative config. Everything else —
 * install hooks, postinstall/preinstall, npm-style scripts, arbitrary extension
 * code, hidden shell bootstrap, provider secrets, auto runtime-config
 * modification, an unregistered/executable evaluator — is REJECTED.
 *
 * The checks:
 *   - structure       — required fields present + correctly typed; version is
 *                       semver-ish; ≥1 criterion (PRD §24.2); ≥1 role.
 *   - PB-002 capability — every `runtimeRequirements.capabilities` entry is a
 *                       KNOWN flattened {@link RuntimeCapabilities} key; if a
 *                       target runtime's capabilities are supplied, every required
 *                       capability must be `true` on it, else `incompatible`
 *                       (incompatibility found BEFORE install, PRD §26.2).
 *   - PB-003 evaluator  — every `criteria[].evaluator` is a REGISTERED id
 *                       (`evaluatorRegistry.has`); an unknown id is
 *                       `unregistered_evaluator`. `config` must be a plain object
 *                       (declarative data, no functions/shell strings). A
 *                       `required: true` `llm_rubric_review` is an error (§20.2 /
 *                       §34-Q7: the non-deterministic reviewer is not a default
 *                       gate).
 *   - §25.2 forbidden   — a DEEP scan for any forbidden key / shape (install
 *                       hooks, postinstall, code/exec/shell/bootstrap string
 *                       bodies, secrets, runtime-config overrides). Any hit →
 *                       `forbidden_content`, naming the offending path.
 *
 * Pure, deterministic, additive: no fs/shell/git, no Date/random. The flattened
 * capability-key set and the forbidden-key matcher are defined as DATA below so
 * they are auditable.
 */

import type { MissionPlaybook } from '@offisim/shared-types';
import type { RuntimeCapabilities } from '@offisim/shared-types';
import type { EvaluatorRegistry } from '../evaluators/registry.js';

// ---------------------------------------------------------------------------
// PB-002 capability keys — the flattened, AUDITABLE set of RuntimeCapabilities
// (PRD §15.3). Kept as data so a reviewer can read the full legal key list and
// so a typo in a playbook is rejected rather than silently ignored.
// ---------------------------------------------------------------------------

/**
 * Every legal flattened capability key, derived from the §15.3
 * {@link RuntimeCapabilities} shape (`group.flag`). This is the source of truth
 * for "is this a known capability key" (PB-002). It is a `Set<string>` so the
 * check is O(1) and the list reads as data.
 */
export const KNOWN_CAPABILITY_KEYS: ReadonlySet<string> = new Set([
  'sessions.resume',
  'sessions.fork',
  'sessions.serializedState',
  'sessions.compaction',
  'interactions.approval',
  'interactions.select',
  'interactions.freeText',
  'multiAgent.children',
  'multiAgent.nestedChildren',
  'multiAgent.handoff',
  'multiAgent.parallel',
  'tools.customTools',
  'tools.dynamicToolSet',
  'tools.preExecutionApproval',
  'artifacts.nativeReferences',
  'artifacts.binary',
  'artifacts.versioned',
  'observability.usage',
  'observability.reasoningDelta',
  'observability.toolLifecycle',
  'observability.nativeTraceReference',
  'workspace.customCwd',
  'workspace.perChildCwd',
]);

/**
 * Resolve a flattened capability key (`group.flag`) on a {@link RuntimeCapabilities}
 * object. Returns `undefined` if the key is not a known shape (the caller has
 * already rejected unknown keys via {@link KNOWN_CAPABILITY_KEYS}); otherwise the
 * boolean support value.
 */
export function capabilityIsAvailable(
  capabilities: RuntimeCapabilities,
  key: string,
): boolean | undefined {
  const [group, flag] = key.split('.', 2);
  if (!group || !flag) return undefined;
  const groupObj = (capabilities as unknown as Record<string, Record<string, boolean>>)[group];
  if (!groupObj || typeof groupObj !== 'object') return undefined;
  const value = groupObj[flag];
  return typeof value === 'boolean' ? value : undefined;
}

// ---------------------------------------------------------------------------
// §25.2 forbidden content — the AUDITABLE deny matcher. Any object key whose
// (case-insensitive) name matches one of these is forbidden. This is the
// make-or-break gate: a playbook that smuggles executable/install content under
// ANY of these keys is rejected, no matter how deeply nested.
// ---------------------------------------------------------------------------

/**
 * Forbidden object key names (PRD §25.2). A playbook is rejected if ANY object
 * anywhere in its structure carries a key matching one of these (case-insensitive,
 * exact key-name match). Kept as a sorted, commented list so the deny surface is
 * auditable. The deny list must cover the SYNONYM space, not just the literal
 * §25.2 wording — otherwise a playbook smuggles the same capability under a
 * different key name (e.g. `onInstall` for `postinstall`, `setup`/`run`/`eval`
 * for `exec`, `credentials`/`password`/`env` for a secret). The categories:
 *   - install/run hooks   : installHooks, onInstall, postinstall, preinstall,
 *                           hooks, setup, scripts
 *   - executable bodies   : extension, extensionCode, code, exec, eval, run,
 *                           invoke, execute, spawn, shell, bootstrap
 *   - secrets / auth      : providerSecret, apiKey, secret, token, credentials,
 *                           credential, password, authorization, env
 *   - runtime-config mods : runtimeConfig, authJson
 *
 * DELIBERATELY EXCLUDED: `'command'`. It is the DECLARATIVE config key of the
 * `command_exit_zero` evaluator (`config: { command: 'pnpm test' }`) — an inert
 * install-time string. Execution only ever happens at RUNTIME through the
 * sandboxed {@link EvaluationContext.runCommand}, which the provider has already
 * passed through the shell classifier + workspace jail + timeout + output cap +
 * redaction (§20.3). The install-time surface a playbook presents does not
 * include running that command, so banning `command` here would break the
 * legitimate declarative evaluator config without closing any real hole.
 */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  // install / run hooks (+ synonyms)
  'installhooks',
  'oninstall',
  'postinstall',
  'preinstall',
  'hooks',
  'setup',
  'scripts',
  // executable / extension bodies (+ synonyms)
  'extension',
  'extensioncode',
  'code',
  'exec',
  'eval',
  'run',
  'invoke',
  'execute',
  'spawn',
  'shell',
  'bootstrap',
  // provider secrets / auth (+ synonyms)
  'providersecret',
  'apikey',
  'secret',
  'token',
  'credentials',
  'credential',
  'password',
  'authorization',
  'env',
  // runtime-config overrides
  'runtimeconfig',
  'authjson',
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PlaybookValidationCode =
  | 'structure'
  | 'incompatible'
  | 'unregistered_evaluator'
  | 'forbidden_content';

/** A single validation failure. `path` locates the offending value. */
export interface PlaybookValidationError {
  readonly code: PlaybookValidationCode;
  readonly message: string;
  /** Dotted JSON path to the offending value (e.g. `criteria[0].evaluator`). */
  readonly path: string;
}

export interface ValidatePlaybookOptions {
  readonly evaluatorRegistry: EvaluatorRegistry;
  /**
   * The capabilities of the runtime the playbook is being checked against. When
   * supplied, every required capability must be `true` on it, else `incompatible`
   * (PRD §26.2 — incompatibility found BEFORE install). When omitted, only the
   * "is a known key" check (PB-002) runs.
   */
  readonly runtimeCapabilities?: RuntimeCapabilities;
}

/**
 * A {@link MissionPlaybook} that has PASSED {@link validatePlaybook} — including
 * the §25.2 forbidden-content scan. The `__validated` brand is unforgeable from
 * outside this module (the only producer is `validatePlaybook`'s success path),
 * so any function that requires a `ValidatedPlaybook` (e.g.
 * {@link materializePlaybook}) makes "you must validate first" a COMPILE-time
 * guarantee instead of a comment-only precondition: passing a raw/unvalidated
 * object is a type error at the call site.
 */
export type ValidatedPlaybook = MissionPlaybook & { readonly __validated: true };

/**
 * The result of {@link validatePlaybook}. A discriminated union on `valid`: the
 * success arm carries the BRANDED playbook (safe to materialize), the failure arm
 * carries the errors. `valid` is true only when there are zero errors of ANY code.
 */
export type PlaybookValidationResult =
  | { readonly valid: true; readonly playbook: ValidatedPlaybook; readonly errors: [] }
  | { readonly valid: false; readonly errors: PlaybookValidationError[] };

// ---------------------------------------------------------------------------
// Forbidden-content deep scan (§25.2)
// ---------------------------------------------------------------------------

/**
 * Recursively scan an arbitrary value for any forbidden key (§25.2). Any object
 * key whose name matches {@link FORBIDDEN_KEYS} (case-insensitive) is a violation,
 * regardless of depth or of whether its value is a string body, object, or null.
 * A cycle guard keeps a hostile self-referential object from looping forever.
 */
function scanForbidden(
  value: unknown,
  path: string,
  errors: PlaybookValidationError[],
  seen: WeakSet<object>,
): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbidden(item, `${path}[${index}]`, errors, seen));
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      errors.push({
        code: 'forbidden_content',
        message: `forbidden key '${key}' at ${childPath}: a Playbook is a declarative asset and must not carry install hooks, executable/extension code, secrets, or runtime-config overrides (§25.2)`,
        path: childPath,
      });
      // Keep scanning the child too — a single object can hide several.
    }
    scanForbidden(child, childPath, errors, seen);
  }
}

// ---------------------------------------------------------------------------
// Structural validation (PB-001 shape)
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validateStructure(
  playbook: Record<string, unknown>,
  errors: PlaybookValidationError[],
): void {
  const structure = (message: string, path: string): void => {
    errors.push({ code: 'structure', message, path });
  };

  if (typeof playbook.id !== 'string' || playbook.id.trim() === '') {
    structure('id must be a non-empty string', 'id');
  }
  if (typeof playbook.version !== 'string' || !SEMVER_RE.test(playbook.version)) {
    structure('version must be a semver string (e.g. 1.0.0)', 'version');
  }
  if (typeof playbook.title !== 'string' || playbook.title.trim() === '') {
    structure('title must be a non-empty string', 'title');
  }
  if (typeof playbook.goalTemplate !== 'string' || playbook.goalTemplate.trim() === '') {
    structure('goalTemplate must be a non-empty string', 'goalTemplate');
  }

  // ≥1 role (PB-001), every role a string.
  if (!isStringArray(playbook.requiredRoles)) {
    structure('requiredRoles must be a string[]', 'requiredRoles');
  } else if (playbook.requiredRoles.length === 0) {
    structure('requiredRoles must have at least one role', 'requiredRoles');
  }

  if (!isStringArray(playbook.requiredSkills)) {
    structure('requiredSkills must be a string[]', 'requiredSkills');
  }

  // runtimeRequirements.capabilities: string[] (content checked by PB-002).
  if (!isPlainObject(playbook.runtimeRequirements)) {
    structure('runtimeRequirements must be an object', 'runtimeRequirements');
  } else if (!isStringArray(playbook.runtimeRequirements.capabilities)) {
    structure(
      'runtimeRequirements.capabilities must be a string[]',
      'runtimeRequirements.capabilities',
    );
  }

  // defaultPolicy.permissionMode ∈ {plan,ask,auto,full}.
  if (!isPlainObject(playbook.defaultPolicy)) {
    structure('defaultPolicy must be an object', 'defaultPolicy');
  } else if (
    playbook.defaultPolicy.permissionMode !== 'plan' &&
    playbook.defaultPolicy.permissionMode !== 'ask' &&
    playbook.defaultPolicy.permissionMode !== 'auto' &&
    playbook.defaultPolicy.permissionMode !== 'full'
  ) {
    structure(
      "defaultPolicy.permissionMode must be one of 'plan' | 'ask' | 'auto' | 'full'",
      'defaultPolicy.permissionMode',
    );
  }

  // defaultBudget.maxAttempts: positive integer; optional fields if present typed.
  if (!isPlainObject(playbook.defaultBudget)) {
    structure('defaultBudget must be an object', 'defaultBudget');
  } else {
    const budget = playbook.defaultBudget;
    if (
      typeof budget.maxAttempts !== 'number' ||
      !Number.isInteger(budget.maxAttempts) ||
      budget.maxAttempts < 1
    ) {
      structure('defaultBudget.maxAttempts must be a positive integer', 'defaultBudget.maxAttempts');
    }
    if (
      budget.maxRepairsPerCriterion !== undefined &&
      (typeof budget.maxRepairsPerCriterion !== 'number' ||
        !Number.isInteger(budget.maxRepairsPerCriterion) ||
        budget.maxRepairsPerCriterion < 0)
    ) {
      structure(
        'defaultBudget.maxRepairsPerCriterion must be a non-negative integer',
        'defaultBudget.maxRepairsPerCriterion',
      );
    }
    if (
      budget.tokenBudget !== undefined &&
      (typeof budget.tokenBudget !== 'number' ||
        !Number.isInteger(budget.tokenBudget) ||
        budget.tokenBudget < 0)
    ) {
      structure('defaultBudget.tokenBudget must be a non-negative integer', 'defaultBudget.tokenBudget');
    }
  }

  // criteria: ≥1, each a well-formed criterion shape (PRD §24.2).
  if (!Array.isArray(playbook.criteria)) {
    structure('criteria must be an array', 'criteria');
  } else if (playbook.criteria.length === 0) {
    structure('criteria must have at least one criterion (PRD §24.2)', 'criteria');
  } else {
    playbook.criteria.forEach((raw, index) => {
      const cPath = `criteria[${index}]`;
      if (!isPlainObject(raw)) {
        structure('criterion must be an object', cPath);
        return;
      }
      if (typeof raw.description !== 'string' || raw.description.trim() === '') {
        structure('criterion.description must be a non-empty string', `${cPath}.description`);
      }
      if (typeof raw.evaluator !== 'string' || raw.evaluator.trim() === '') {
        structure('criterion.evaluator must be a non-empty string', `${cPath}.evaluator`);
      }
      // config must be a PLAIN object — declarative data, never a function or a
      // shell string standing in for the evaluator (§20.3).
      if (!isPlainObject(raw.config)) {
        structure('criterion.config must be a plain object (declarative data)', `${cPath}.config`);
      }
      if (raw.required !== undefined && typeof raw.required !== 'boolean') {
        structure('criterion.required must be a boolean when present', `${cPath}.required`);
      }
    });
  }

  // artifacts: array of { kind: string }.
  if (!Array.isArray(playbook.artifacts)) {
    structure('artifacts must be an array', 'artifacts');
  } else {
    playbook.artifacts.forEach((raw, index) => {
      const aPath = `artifacts[${index}]`;
      if (!isPlainObject(raw) || typeof raw.kind !== 'string' || raw.kind.trim() === '') {
        structure('artifact must be an object with a non-empty kind', `${aPath}.kind`);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// PB-002 — capability checks
// ---------------------------------------------------------------------------

function validateCapabilities(
  playbook: Record<string, unknown>,
  opts: ValidatePlaybookOptions,
  errors: PlaybookValidationError[],
): void {
  const requirements = playbook.runtimeRequirements;
  if (!isPlainObject(requirements) || !isStringArray(requirements.capabilities)) return; // structure already flagged
  requirements.capabilities.forEach((key, index) => {
    const path = `runtimeRequirements.capabilities[${index}]`;
    if (!KNOWN_CAPABILITY_KEYS.has(key)) {
      errors.push({
        code: 'structure',
        message: `unknown capability key '${key}': not a flattened RuntimeCapabilities key (PB-002)`,
        path,
      });
      return; // can't check availability of a key we don't recognize
    }
    if (opts.runtimeCapabilities) {
      const available = capabilityIsAvailable(opts.runtimeCapabilities, key);
      if (available !== true) {
        errors.push({
          code: 'incompatible',
          message: `runtime does not support required capability '${key}' (incompatibility found before install, PRD §26.2)`,
          path,
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// PB-003 — evaluator checks
// ---------------------------------------------------------------------------

function validateEvaluators(
  playbook: Record<string, unknown>,
  opts: ValidatePlaybookOptions,
  errors: PlaybookValidationError[],
): void {
  if (!Array.isArray(playbook.criteria)) return; // structure already flagged
  playbook.criteria.forEach((raw, index) => {
    if (!isPlainObject(raw)) return;
    const cPath = `criteria[${index}]`;
    const evaluator = raw.evaluator;
    if (typeof evaluator !== 'string' || evaluator.trim() === '') return; // structure flagged

    if (!opts.evaluatorRegistry.has(evaluator)) {
      errors.push({
        code: 'unregistered_evaluator',
        message: `evaluator '${evaluator}' is not registered: a Playbook may only reference a registered evaluator (§20.3 / MS-003)`,
        path: `${cPath}.evaluator`,
      });
      return;
    }

    // §20.2 / §34-Q7: the non-deterministic LLM reviewer is NOT a default gate.
    // A `required: true` llm_rubric_review criterion is rejected with a clear
    // message. Only an EXPLICIT required:true is an error here — an absent/false
    // value keeps the reviewer advisory, which is allowed. The materializer agrees:
    // it defaults an ABSENT `required` to false specifically for llm_rubric_review
    // (so an advisory reviewer never silently becomes a hard gate downstream).
    if (evaluator === 'llm_rubric_review' && raw.required === true) {
      errors.push({
        code: 'structure',
        message:
          "llm_rubric_review is non-deterministic and must not be a required gate (set required:false / omit it) — a deterministic FAIL can never be overridden by an LLM PASS (PRD §20.2, §34-Q7)",
        path: `${cPath}.required`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Validate a Playbook (PB-002 + PB-003 + the §25.2 safety gate). Accepts an
 * `unknown` so untrusted Marketplace input can be checked before it is ever typed
 * as a {@link MissionPlaybook}. Returns a discriminated union: on success the
 * BRANDED {@link ValidatedPlaybook} (the only way to obtain the brand), on failure
 * the errors. `valid` is true only when there are zero errors of ANY code.
 *
 * Guarantee on success: the playbook is pure declarative data that references
 * ONLY registered evaluators with declarative config and carries NO
 * executable/install content. The brand makes that guarantee load-bearing —
 * {@link materializePlaybook} only accepts a `ValidatedPlaybook`, so an
 * unvalidated object cannot reach materialization without a compile error.
 */
export function validatePlaybook(
  playbook: unknown,
  opts: ValidatePlaybookOptions,
): PlaybookValidationResult {
  const errors: PlaybookValidationError[] = [];

  // §25.2 forbidden-content scan runs on the RAW input first — it must not depend
  // on the structure being valid, since smuggled content is most dangerous when
  // the rest of the playbook looks well-formed.
  scanForbidden(playbook, '', errors, new WeakSet<object>());

  if (!isPlainObject(playbook)) {
    errors.push({ code: 'structure', message: 'playbook must be an object', path: '' });
    return { valid: false, errors };
  }

  validateStructure(playbook, errors);
  validateCapabilities(playbook, opts, errors);
  validateEvaluators(playbook, opts, errors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  // Brand ONLY after every check (incl. the forbidden scan) has passed. The cast
  // is the single trust boundary: from here on the type system carries the proof.
  return { valid: true, playbook: playbook as unknown as ValidatedPlaybook, errors: [] };
}
