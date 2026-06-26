/**
 * Loop authoring state machine (PR-08) — the PURE, deterministic logic the
 * prompt-first editor drives. Kept React- and Tauri-free so the headless harness
 * (`scripts/harness-loop-authoring-flow.mts`) exercises every transition and the
 * Use/Save guards without a DOM or a live model.
 *
 * The editor owns ONE natural-language prompt + a compiled revision. This module
 * maps (editor inputs, compile/save outcomes) → the authoring state the UI renders
 * and the action guards (can Use? can Save?) — never the rendering itself.
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
  /** Set when a compile/save threw (vs returned an `invalid` status). Never loses prompt. */
  errored: boolean;
  /** The latest compiled revision view, or null before the first compile. */
  compiled: CompiledRevisionView | null;
  /** Set true once the latest compile was persisted as a new revision. */
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

  if (model.justSaved) return 'saved';
  return compileStatusToState(model.compiled.status);
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
  return (
    model.prompt.trim().length > 0 &&
    !model.compiling &&
    !model.enhancing &&
    !model.saving
  );
}

/**
 * Whether the editor may SAVE a revision: a compiled outcome must exist (any
 * status — even needs_input/invalid is a savable immutable revision per the spec),
 * the prompt must be non-empty, and nothing is in flight. We DO allow saving a
 * needs_input/invalid revision (the history is preserved); the Use guard is the
 * one that requires `ready`.
 */
export function canSave(model: LoopAuthoringModel): boolean {
  return (
    model.compiled !== null &&
    model.prompt.trim().length > 0 &&
    !model.compiling &&
    !model.enhancing &&
    !model.saving
  );
}

/**
 * Whether the editor may USE-in-Office: ONLY a SAVED + READY revision can be used.
 * An unsaved prompt, a dirty graph, a needs_input/invalid revision, or a compiled-
 * but-not-persisted preview all block Use — the UI prompts "Compile + Save first".
 * This mirrors `openLoopInOffice`'s own revision-ready guard (defense in depth).
 */
export function canUseInOffice(model: LoopAuthoringModel): boolean {
  const compiled = model.compiled;
  if (!compiled) return false;
  if (isDirty(model)) return false;
  if (compiled.status !== 'ready') return false;
  if (!compiled.savedRevisionId) return false;
  return !model.compiling && !model.enhancing && !model.saving;
}

/** A one-line reason Use is blocked, for the disabled-button tooltip / toast. */
export function useBlockedReason(model: LoopAuthoringModel): string | null {
  if (canUseInOffice(model)) return null;
  if (!model.compiled) return 'Compile and save this Loop before using it.';
  if (isDirty(model)) return 'The prompt changed — recompile and save first.';
  if (model.compiled.status !== 'ready') {
    return 'This Loop is not ready yet — resolve the questions or issues, then save.';
  }
  if (!model.compiled.savedRevisionId) return 'Save this revision before using it.';
  return 'Loop is busy — wait for the current step to finish.';
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
