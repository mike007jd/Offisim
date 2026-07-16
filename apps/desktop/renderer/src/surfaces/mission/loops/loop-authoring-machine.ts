/**
 * Loop authoring state machine (PR-08) — the PURE, deterministic logic the
 * prompt-first editor drives. Kept React- and Tauri-free so the headless harness
 * (`scripts/harness-loop-authoring-flow.mts`) exercises every transition and the
 * Run/Save guards without a DOM or a live model.
 *
 * The editor owns ONE natural-language prompt + a compiled revision. This module
 * maps (editor inputs, generate/save outcomes) → the authoring state the UI renders
 * and the action guards (can Run? can Save?) — never the rendering itself.
 *
 * States (spec):
 *   empty → draft → enhancing → compiling → needs_input → ready
 *   ready ─prompt-changed→ dirty → compiling … (old graph stays visible, stale)
 *   compiling ─bad→ invalid | error  (prompt is NEVER lost)
 *   ready ─save→ saving → saved
 */

import type {
  LoopCompileQuestion,
  LoopCompileStatus,
  LoopValidationFinding,
} from '@offisim/shared-types';

export type LoopAuthoringState =
  | 'empty'
  | 'draft'
  | 'enhancing'
  | 'compiling'
  | 'needs_input'
  | 'ready'
  | 'dirty'
  | 'invalid'
  | 'error'
  | 'saving'
  | 'saved';

/** The map of `LoopCompileStatus` → the matching authoring state after a compile. */
export function compileStatusToState(status: LoopCompileStatus): LoopAuthoringState {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'needs_input':
      return 'needs_input';
    case 'invalid':
      return 'invalid';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unknown compile status: ${String(exhaustive)}`);
    }
  }
}

/** A compiled, savable revision (the latest compile outcome shown in the editor). */
export interface CompiledRevisionView {
  status: LoopCompileStatus;
  /** The serialized IR (or '{}' for needs_input/invalid). Parsed lazily by the UI. */
  compiledIrJson: string;
  questions: LoopCompileQuestion[];
  findings: LoopValidationFinding[];
  /** The enhanced prose the compile produced (echoed for the version diff). */
  enhancedPrompt?: string;
  /** The exact source prompt this revision compiled from — used for dirty detection. */
  sourcePrompt: string;
  /** The persisted revision id, once Save lands. Absent while only previewed. */
  savedRevisionId?: string;
  savedRevisionNumber?: number;
}

/** The whole editor model the state machine derives a state from. */
export interface LoopAuthoringModel {
  /** The single natural-language prompt the user is editing. */
  prompt: string;
  /** True while an enhance dialog is in flight. */
  enhancing: boolean;
  /** True while a compile is in flight. */
  compiling: boolean;
  /** True while a save is in flight. */
  saving: boolean;
  /** Set when generate/save threw (vs returned an `invalid` status). Never loses prompt. */
  errored: boolean;
  /** The latest compiled revision view, or null before the first compile. */
  compiled: CompiledRevisionView | null;
  /** Immediate save-success signal; persisted revisions remain saved after hydration. */
  justSaved: boolean;
}

export const EMPTY_AUTHORING_MODEL: LoopAuthoringModel = {
  prompt: '',
  enhancing: false,
  compiling: false,
  saving: false,
  errored: false,
  compiled: null,
  justSaved: false,
};

/**
 * Derive the authoring state from the editor model. Single source of truth so the
 * UI and the harness agree on every transition. Order matters: in-flight phases
 * win over resting phases; a prompt that diverged from the compiled revision is
 * `dirty` (old graph stays visible with a stale badge).
 */
export function deriveAuthoringState(model: LoopAuthoringModel): LoopAuthoringState {
  if (model.saving) return 'saving';
  if (model.compiling) return 'compiling';
  if (model.enhancing) return 'enhancing';
  if (model.errored) return 'error';

  if (!model.compiled) {
    // Nothing compiled yet: empty prompt → empty (examples), typed → draft.
    return model.prompt.trim().length === 0 ? 'empty' : 'draft';
  }

  // A compiled revision exists. If the prompt changed since it compiled, the graph
  // is stale → dirty (the old graph still renders; the UI shows a stale badge).
  if (isDirty(model)) return 'dirty';

  // Persistence is not a business state. A selected/hydrated needs_input or
  // invalid revision must still surface its questions/findings instead of being
  // masked as saved. Only a ready revision becomes the resting `saved` state.
  const compiledState = compileStatusToState(model.compiled.status);
  if (compiledState !== 'ready') return compiledState;
  if (model.justSaved || model.compiled.savedRevisionId) return 'saved';
  return compiledState;
}

/**
 * The prompt diverged from the compiled revision's source → the graph is stale.
 * Compared trimmed so trailing-whitespace edits do not mark a clean graph dirty.
 */
export function isDirty(model: LoopAuthoringModel): boolean {
  if (!model.compiled) return false;
  return model.prompt.trim() !== model.compiled.sourcePrompt.trim();
}

/**
 * Whether the editor may COMPILE: there must be a non-empty prompt and nothing
 * already in flight.
 */
export function canCompile(model: LoopAuthoringModel): boolean {
  return model.prompt.trim().length > 0 && !model.compiling && !model.enhancing && !model.saving;
}

/**
 * Whether the editor may SAVE a new revision: an unpersisted compiled outcome must exist (any
 * status — even needs_input/invalid is a savable immutable revision per the spec),
 * the prompt must be non-empty, and nothing is in flight. We DO allow saving a
 * needs_input/invalid revision (the history is preserved); the Use guard is the
 * one that requires `ready`.
 */
export function canSave(model: LoopAuthoringModel): boolean {
  return (
    model.compiled !== null &&
    !model.compiled.savedRevisionId &&
    model.prompt.trim().length > 0 &&
    !isDirty(model) &&
    !model.compiling &&
    !model.enhancing &&
    !model.saving
  );
}

/**
 * Whether the editor may RUN: ONLY a SAVED + READY revision can be run.
 * An unsaved prompt, a dirty graph, a needs_input/invalid revision, or a compiled-
 * but-not-persisted preview all block Run. This mirrors the execution boundary's
 * own revision-ready guard.
 */
export function canUseInOffice(model: LoopAuthoringModel): boolean {
  const compiled = model.compiled;
  if (!compiled) return false;
  if (isDirty(model)) return false;
  if (compiled.status !== 'ready') return false;
  if (!compiled.savedRevisionId) return false;
  return !model.compiling && !model.enhancing && !model.saving;
}

/** A one-line reason Run is blocked, for the disabled-button tooltip / toast. */
export function useBlockedReason(model: LoopAuthoringModel): string | null {
  if (canUseInOffice(model)) return null;
  if (!model.compiled) return 'Generate and save this plan before running it.';
  if (isDirty(model)) return 'The description changed — update and save the plan first.';
  if (model.compiled.status !== 'ready') {
    return 'This plan needs more information before it can run.';
  }
  if (!model.compiled.savedRevisionId) return 'Save this plan before running it.';
  return 'The plan is busy — wait for the current action to finish.';
}

/** The graph-panel state this authoring state maps to (PR-09 `LoopGraphPanelState`). */
export function graphStateFor(
  state: LoopAuthoringState,
  compiled: CompiledRevisionView | null,
): 'empty' | 'compiling' | 'ready' | 'invalid' | 'error' {
  if (state === 'compiling') return 'compiling';
  if (state === 'error') return 'error';
  if (!compiled) return 'empty';
  // ready / needs_input / dirty all keep the last good graph visible (dirty shows a
  // stale badge over it); invalid keeps the graph but flags findings.
  if (compiled.status === 'invalid') return 'invalid';
  if (compiled.status === 'ready') return 'ready';
  // needs_input has no legal IR → empty graph + question cards drive the UI.
  return 'empty';
}
