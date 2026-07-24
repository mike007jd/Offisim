import { useUiState } from '@/app/ui-state.js';
import { getLoopDefinition, getLoopRevision } from '@/data/loops.js';
import { toast } from 'sonner';
import {
  type ComposerLoopReference,
  type InsertLoopReferenceInput,
  resolveLoopReference,
  useComposerLoopReferenceStore,
} from './composer-loop-reference-store.js';
import { resolveSkillReferences } from './composer-skill-reference-store.js';

/**
 * The Loop → Office insert API (PR-10). ONE function — `openLoopInOffice` — is
 * what the Loops page "Use in Office" button (PR-08) calls; the in-composer
 * `/loop` picker calls `insertLoopReferenceFromPicker`, which shares the SAME
 * underlying insert. Neither RUNS the loop — they only open/insert a structured,
 * pinned-revision chip. Send is the only thing that materializes an invocation.
 *
 * `@` stays people-only; this is the dedicated Loop path.
 */

/** The chip-shaped input the picker / Loops page resolves before inserting. */
export interface LoopReferenceCandidate {
  loopId: string;
  revisionId: string;
  titleSnapshot: string;
  revisionNumber: number;
  profileId: string;
}

export type OpenLoopInOfficeResult =
  | { ok: true; threadId: string; reference: ComposerLoopReference }
  | { ok: false; reason: 'revision-not-ready' | 'no-project-selected' | 'already-present' };

/**
 * "Use in Office" entry — the API PR-08 calls.
 *
 *   1. validate the revision is READY (a not-ready / missing revision is refused);
 *   2. if there is NO active project, route to an explicit project selector and
 *      stop — never invent a hidden default project (the flow resumes after
 *      selection via `pendingLoopProjectSelect`);
 *   3. open an Office NEW draft conversation (no persisted empty thread);
 *   4. insert the Loop chip into that draft's composer;
 *   5. focus the composer (handled by the Office surface on draft open).
 *
 * NEVER auto-sends.
 */
export async function openLoopInOffice(
  loopId: string,
  revisionId: string,
): Promise<OpenLoopInOfficeResult> {
  // 1. Validate the pinned revision is ready before anything navigates.
  const revision = await getLoopRevision(revisionId);
  if (!revision || revision.compileStatus !== 'ready') {
    toast.error('This Loop revision is not ready to use yet.');
    return { ok: false, reason: 'revision-not-ready' };
  }
  const definition = await getLoopDefinition(loopId);
  const title = definition?.title ?? 'Loop';
  const profileId = definition?.profileId ?? revision.compilerProfileId;

  // 2. No active project → explicit selector, carrying the loop+revision to resume.
  const state = useUiState.getState();
  if (!state.projectId) {
    state.requestLoopProjectSelect({ loopId, revisionId });
    toast.message('Select a project to use this Loop in Office.');
    return { ok: false, reason: 'no-project-selected' };
  }

  // 3. Open a fresh Office draft (no DB row yet) and focus Office.
  state.setSurface('office');
  const threadId = state.openDraftThread();

  // 4. Insert the chip into the new draft.
  const inserted = applyLoopReference(threadId, {
    loopId,
    revisionId,
    titleSnapshot: title,
    revisionNumber: revision.revisionNumber,
    profileId,
  });
  if (!inserted.ok) {
    // A brand-new draft can't already hold a chip, but stay defensive.
    return { ok: false, reason: 'already-present' };
  }
  return { ok: true, threadId, reference: inserted.reference };
}

/**
 * Insert a Loop chip into the CURRENTLY-OPEN Office thread (the `/loop` picker
 * path — the user is already in a conversation). Shares the single-primary rule
 * and the same store as "Use in Office". Surfaces the v1 block as a toast.
 */
export function insertLoopReferenceFromPicker(
  threadId: string,
  candidate: LoopReferenceCandidate,
): { ok: boolean } {
  if (resolveSkillReferences(threadId).length) {
    toast.message('A Loop cannot be combined with Skill references.', {
      description: 'Remove the Skill chips before adding a Loop.',
    });
    return { ok: false };
  }
  const result = applyLoopReference(threadId, candidate);
  if (!result.ok) {
    const existing = resolveLoopReference(threadId);
    if (existing && existing.loopId === candidate.loopId) {
      toast.message(`This message already references "${existing.titleSnapshot}".`);
    } else {
      toast.message('A message can reference one Loop at a time. Remove the current Loop first.');
    }
    return { ok: false };
  }
  return { ok: true };
}

/** The shared insert both entries funnel through (enforces the v1 single-primary
 *  rule via the store). */
function applyLoopReference(threadId: string, input: InsertLoopReferenceInput) {
  return useComposerLoopReferenceStore.getState().insertReference(threadId, input);
}

/**
 * Explicit user Update to a newer revision of the SAME loop (the chip's "Update"
 * action when a `vN+1 available` badge shows). Never auto-invoked — the user
 * clicks Update. Re-pins the chip onto the new revision.
 */
export function updateLoopReferenceRevision(
  threadId: string,
  input: InsertLoopReferenceInput,
): ComposerLoopReference {
  return useComposerLoopReferenceStore.getState().replaceReference(threadId, input);
}
