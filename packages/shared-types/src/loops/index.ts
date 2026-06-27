/**
 * Loop domain model (PR-07). A Loop is a real, saveable, versioned, reusable
 * wrapper around the existing Mission engine: natural language compiles (via a
 * compiler profile) into a stable generic {@link LoopIR}, stored on an immutable
 * revision. SAVING a Loop creates ONLY definition/revision/binding rows — never a
 * Mission, chat_thread, attempt, or run (that is PR-10's send-time job).
 *
 * Truth lives in Offisim SQLite (`loop_definitions` / `loop_revisions` /
 * `loop_skill_bindings` / `loop_invocations`). Field names are camelCase (domain);
 * the SQLite columns are snake_case and the mapping lives in the repositories
 * (`@offisim/core` runtime/repos/loops).
 */

export type {
  LoopIR,
  LoopNode,
  LoopNodeKind,
  LoopEdge,
  LoopEdgeKind,
  LoopChildGraph,
  LoopPort,
  LoopParameter,
  LoopCompletionContract,
  LoopAcceptanceItem,
  LoopBudgetContract,
  LoopHumanGate,
  LoopSkillBindingRef,
} from './ir.js';

// ---------------------------------------------------------------------------
// Loop definition
// ---------------------------------------------------------------------------

export type LoopStatus = 'draft' | 'ready' | 'archived';

export interface LoopDefinition {
  loopId: string;
  companyId: string;
  title: string;
  summary: string;
  /** Compiler profile this Loop was authored with (e.g. 'software-development'). */
  profileId: string;
  /** The revision currently selected as the Loop's live shape (ready/draft). */
  currentRevisionId?: string;
  status: LoopStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Loop revision (IMMUTABLE — any edit creates a new revision)
// ---------------------------------------------------------------------------

export type LoopCompileStatus = 'ready' | 'needs_input' | 'invalid';

/**
 * A clarifying question the compiler emits when a material value cannot be
 * inferred. Capped at THREE per revision; each carries a recommended default so
 * the user can answer "use the defaults".
 */
export interface LoopCompileQuestion {
  id: string;
  question: string;
  /** Recommended default the UI pre-fills. */
  recommendedDefault: string;
  /** Optional choices when the answer is an enum. */
  options?: string[];
}

export interface LoopRevision {
  revisionId: string;
  loopId: string;
  /** Monotonic per loop, starting at 1. */
  revisionNumber: number;
  sourcePrompt: string;
  /** The PR-06 loop_design enhanced NL, if an enhance ran; else null. */
  enhancedPrompt?: string;
  /** Serialized {@link LoopIR}. */
  compiledIrJson: string;
  compilerProfileId: string;
  compilerProfileVersion: string;
  /** The compiler engine version (distinct from the profile asset version). */
  compilerVersion: string;
  compileStatus: LoopCompileStatus;
  /** Serialized {@link LoopCompileQuestion}[] (≤3). */
  questionsJson: string;
  /** Serialized {@link LoopValidation}. */
  validationJson: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Validation result (stored on the revision)
// ---------------------------------------------------------------------------

export type LoopValidationSeverity = 'error' | 'warning';

export interface LoopValidationFinding {
  code: string;
  message: string;
  severity: LoopValidationSeverity;
  /** Optional node/edge id the finding points at. */
  ref?: string;
}

export interface LoopValidation {
  ok: boolean;
  findings: LoopValidationFinding[];
}

// ---------------------------------------------------------------------------
// Skill binding (per revision; immutable with the revision)
// ---------------------------------------------------------------------------

export interface LoopSkillBinding {
  bindingId: string;
  revisionId: string;
  skillId: string;
  skillVersion: string;
  orderIndex: number;
  /** Serialized per-binding config JSON object. */
  configJson: string;
}

// ---------------------------------------------------------------------------
// Loop invocation (table + contract ONLY in PR-07; PR-10 writes it at Office Send)
// ---------------------------------------------------------------------------

/**
 * A record that a Loop was launched into a Mission run. Created ONLY at Office Send
 * materialization (PR-10) — never on Save or Use. PR-07 defines the table + the
 * row contract so the schema and repo exist; no PR-07 code path writes a row.
 */
export interface LoopInvocation {
  invocationId: string;
  loopId: string;
  revisionId: string;
  companyId: string;
  projectId?: string;
  threadId: string;
  messageId: string;
  /** The Mission this invocation materialized into (set once PR-10 builds it). */
  missionId?: string;
  status: string;
  createdAt: string;
}
