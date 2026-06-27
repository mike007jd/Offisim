/**
 * Generic Loop IR v1 (PR-07). The business truth of a Loop is a GENERIC graph
 * IR, never a software-only schema. A compiler profile (e.g. software-development)
 * turns natural language into this shape; the same shape powers the graph panel
 * (PR-09) and the Mission execution adapter (PR-10).
 *
 * Types-only contract. `LoopIR` is stored verbatim as `compiled_ir_json` on an
 * immutable `loop_revisions` row; the validator (core `loops/validate.ts`) is the
 * only writer of "is this IR legal". Field names are camelCase (domain); the
 * SQLite columns are snake_case and the mapping lives in the repositories.
 */

// ---------------------------------------------------------------------------
// Ports, parameters, contracts
// ---------------------------------------------------------------------------

/** Data flowing into or out of the loop (or a subloop). */
export interface LoopPort {
  /** Stable id, unique within the IR's inputs+outputs set. */
  id: string;
  /** Human label shown in the graph panel. */
  label: string;
  /** Free-form type tag the profile assigns (e.g. 'text', 'repo', 'artifact'). */
  type: string;
  /** False → the loop can run without this port being supplied. */
  required: boolean;
  /** Optional one-line description for the UI / packet. */
  description?: string;
}

/** A tunable the user (or the profile default) sets before a run. */
export interface LoopParameter {
  id: string;
  label: string;
  kind: 'string' | 'number' | 'boolean' | 'enum';
  /** Default value; serialized as-is into the IR. */
  defaultValue: string | number | boolean;
  /** For kind === 'enum': the allowed values. */
  options?: string[];
  description?: string;
}

/**
 * How the loop knows it is DONE. The adapter (PR-10) maps each acceptance item to
 * an internal Mission criterion; `humanGateIds` items become human gates, never
 * raw evaluator JSON the user must hand-write.
 */
export interface LoopCompletionContract {
  /** One precise statement of the intended result (maps to Mission goal context). */
  outcome: string;
  /** Observable acceptance items; each becomes a Mission criterion candidate. */
  acceptance: LoopAcceptanceItem[];
  /** Exit states the loop can reach (success / budget-exhausted / blocked-handoff…). */
  exitStates: string[];
}

/** One observable acceptance criterion. */
export interface LoopAcceptanceItem {
  id: string;
  /** What is being verified, in plain language. */
  description: string;
  /**
   * How it is verified. `deterministic` items map to a Mission evaluator; `review`
   * and `human` items become a warning/human gate (the adapter never fabricates an
   * evaluator config for a non-determinable item).
   */
  oracle: 'deterministic' | 'review' | 'human';
  /** For deterministic oracles: the evaluator id the adapter should bind. */
  evaluatorId?: string;
  /** Must this pass for the loop to reach success? */
  required: boolean;
}

/** Hard caps, mirrored from the profile's consumption tier. */
export interface LoopBudgetContract {
  /** Declared tier the budget was derived from. */
  tier: 'light' | 'standard' | 'aggressive';
  maxConcurrentAgents: number;
  maxTotalAgents: number;
  maxRecursionDepth: number;
  /** Default 3 — fix-waves per gate before escalating to blocked-handoff. */
  maxFixWavesPerGate: number;
  /** Optional wall-clock ceiling in minutes. */
  wallClockMinutes?: number;
  /** Optional token ceiling. */
  tokenCeiling?: number;
}

/** A point where a human must decide before the loop proceeds. */
export interface LoopHumanGate {
  id: string;
  /** The node id this gate guards (must reference a node of kind 'human_gate'). */
  nodeId: string;
  /** The decision the human owns. */
  prompt: string;
  /** Why it is human-owned (irreversible, product call, out of authority…). */
  reason: string;
}

/** A skill the loop binds, referenced by the IR (resolved at packet build). */
export interface LoopSkillBindingRef {
  skillId: string;
  skillVersion: string;
  /** Render/exec order. */
  orderIndex: number;
  /** Opaque per-binding config (serialized JSON object). */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export type LoopNodeKind =
  | 'start'
  | 'action'
  | 'decision'
  | 'verify'
  | 'human_gate'
  | 'subloop'
  | 'finish';

/**
 * A graph node. A `subloop` node references EITHER an inline child graph
 * (`childGraph`) OR a saved revision (`subloopRevisionId`) — exactly one. All
 * other kinds carry neither.
 */
export interface LoopNode {
  id: string;
  kind: LoopNodeKind;
  label: string;
  /** Optional free-form note shown in the panel / carried into the packet. */
  description?: string;
  /**
   * subloop only: an inline nested graph (nodes/edges of the same shape). Mutually
   * exclusive with `subloopRevisionId`.
   */
  childGraph?: LoopChildGraph;
  /**
   * subloop only: a reference to a saved loop revision. Mutually exclusive with
   * `childGraph`. The validator checks the ref resolves against the supplied set.
   */
  subloopRevisionId?: string;
}

/** An inline nested graph embedded in a subloop node. */
export interface LoopChildGraph {
  nodes: LoopNode[];
  edges: LoopEdge[];
}

export type LoopEdgeKind = 'next' | 'feedback' | 'retry' | 'escalate';

export interface LoopEdge {
  id: string;
  from: string;
  to: string;
  kind: LoopEdgeKind;
  /** Optional label for decision branches ('pass' / 'fail' / etc.). */
  label?: string;
  /**
   * For `retry` edges: the max number of times this retry may fire. The validator
   * REJECTS a retry edge with no positive bound (unbounded retry is illegal).
   */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Top-level IR
// ---------------------------------------------------------------------------

export interface LoopIR {
  schemaVersion: '1';
  title: string;
  outcome: string;
  inputs: LoopPort[];
  outputs: LoopPort[];
  parameters: LoopParameter[];
  nodes: LoopNode[];
  edges: LoopEdge[];
  completion: LoopCompletionContract;
  budget?: LoopBudgetContract;
  humanGates: LoopHumanGate[];
  skillBindings: LoopSkillBindingRef[];
  /**
   * Profile-specific structured payload (e.g. software-development carries
   * acceptance demo, scope/non-goals, repository evidence, authority, oracles,
   * contracts, topology, integration, cleanup). Opaque to the generic layer; the
   * profile's `validateProfileData` checks it.
   */
  profileData?: Record<string, unknown>;
  metadata: {
    profileId: string;
    profileVersion: string;
    compilerVersion: string;
  };
}
