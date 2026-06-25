/**
 * Mission Playbook schema (PRD §25.1, slice PB-001) — the declarative asset a
 * Marketplace "mission_template / playbook" distributes (PRD §25).
 *
 * A Playbook is a DECLARATIVE asset and NOTHING ELSE (PRD §25.2). It carries the
 * neutral business semantics of a verified mission — its goal template, the roles
 * and skills it needs, the runtime capabilities it requires, the default policy
 * and budget, and the criteria it is graded against — but it MUST NEVER carry any
 * executable or install-time content: no install hooks, no postinstall, no
 * arbitrary extension code, no hidden shell bootstrap, no provider secret, no
 * auto runtime-config modification, and no unregistered/executable evaluator. The
 * PB-002/003 validator (`@offisim/core` runtime/mission/playbook/validate) is the
 * gate that ENFORCES that rule; this module only describes the shape.
 *
 * Vendor-neutral by construction: the Marketplace stores this NEUTRAL playbook,
 * and each runtime Driver materializes it locally into a runtime-native resource
 * (PRD §25.3). The only runtime-specific affordance is the optional, declarative
 * `materialization` mapping (PB-004) — a DATA mapping (skill → target), never
 * code.
 *
 * Types-only and additive at PB-001: nothing references these shapes yet; the
 * validator (PB-002/003) and the materializer (PB-004) consume them.
 */

import type { MissionEvaluationVerdict } from './index.js';

/**
 * The permission mode a Playbook declares as its default gate posture. The same
 * `plan < ask < auto < full` ladder the Composer uses (renderer
 * `PermissionMode`); inlined here because a Playbook is the canonical declarative
 * home for the value and shared-types must not depend on renderer code.
 */
export type PlaybookPermissionMode = 'plan' | 'ask' | 'auto' | 'full';

/**
 * One acceptance criterion of a Playbook. `evaluator` MUST name a registered
 * evaluator id (validated by PB-003 against the EvaluatorRegistry, MS-003) and
 * `config` is DECLARATIVE data only — never a shell string, never a function
 * (§20.3: "不允许 Playbook 携带任意 shell evaluator 脚本"). `required` defaults to
 * `true` at materialization; an absent value means "treat as a gate".
 */
export interface PlaybookCriterion {
  readonly description: string;
  /** A registered evaluator id (MS-003); an unknown id is rejected by PB-003. */
  readonly evaluator: string;
  /** Declarative evaluator config — plain JSON data, never executable. */
  readonly config: Record<string, unknown>;
  readonly required?: boolean;
}

/** An expected output contract — the kind of artifact the mission should yield. */
export interface PlaybookArtifactSpec {
  readonly kind: string;
}

/** The runtime capabilities a Playbook requires (PB-002). */
export interface PlaybookRuntimeRequirements {
  /**
   * Flattened {@link RuntimeCapabilities} keys (e.g. `'sessions.resume'`,
   * `'tools.customTools'`, `'multiAgent.children'`). Validated by PB-002 against
   * the known capability-key set, and — when a target runtime's capabilities are
   * supplied — against that runtime's actual support (incompatibility found
   * BEFORE install, PRD §26.2).
   */
  readonly capabilities: readonly string[];
}

/** The default policy a Playbook seeds a mission with. */
export interface PlaybookDefaultPolicy {
  readonly permissionMode: PlaybookPermissionMode;
}

/** The default budget a Playbook seeds a mission with (PRD §19.2 caps apply). */
export interface PlaybookDefaultBudget {
  readonly maxAttempts: number;
  readonly maxRepairsPerCriterion?: number;
  readonly tokenBudget?: number;
}

/**
 * A single runtime-specific skill mapping (PB-004): a NEUTRAL declaration that a
 * named skill should be bound to a local target resource. Pure data — the Driver
 * does the actual binding at materialize time; the Marketplace never ships code.
 */
export interface PlaybookSkillMapping {
  readonly skill: string;
  readonly target: string;
}

/** Pi-runtime materialization mapping (PB-004). Declarative skill bindings only. */
export interface PlaybookPiMaterialization {
  readonly skillMappings?: readonly PlaybookSkillMapping[];
}

/**
 * Runtime-specific materialization mappings (PB-004). The Marketplace stores the
 * neutral playbook; each Driver materializes the relevant block locally into a
 * runtime-native resource declaration (PRD §25.3). Only Pi is defined in this
 * slice; future runtimes add sibling blocks.
 */
export interface PlaybookMaterialization {
  readonly pi?: PlaybookPiMaterialization;
}

/**
 * A declarative Mission Template (a.k.a. `mission_template` / `playbook`,
 * PRD §25.1). The complete, neutral, install-safe asset. Every field is data; a
 * valid playbook references ONLY registered evaluators with declarative config
 * and carries NO executable/install content (enforced by PB-002/003).
 */
export interface MissionPlaybook {
  /** Stable identifier, e.g. `'product-feature-delivery'`. */
  readonly id: string;
  /** Semver, e.g. `'1.0.0'`. */
  readonly version: string;
  readonly title: string;
  /** The goal text / template the mission is seeded with. */
  readonly goalTemplate: string;
  /** Roles the playbook requires, e.g. `['pm', 'engineer', 'reviewer']`. */
  readonly requiredRoles: readonly string[];
  readonly requiredSkills: readonly string[];
  readonly runtimeRequirements: PlaybookRuntimeRequirements;
  readonly defaultPolicy: PlaybookDefaultPolicy;
  readonly defaultBudget: PlaybookDefaultBudget;
  /** ≥1 criterion (PRD §24.2). Each references a registered evaluator (PB-003). */
  readonly criteria: readonly PlaybookCriterion[];
  readonly artifacts: readonly PlaybookArtifactSpec[];
  /** Optional runtime-specific materialization mappings (PB-004). */
  readonly materialization?: PlaybookMaterialization;
}

/** A verdict a Playbook criterion can resolve to once it becomes a mission
 *  criterion — re-exported alias so PB consumers speak the §17.4 vocabulary. */
export type PlaybookCriterionVerdict = MissionEvaluationVerdict;
