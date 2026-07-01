import { buildEnhanceRequest, runEnhance } from '@/assistant/enhance/service.js';
import { createTauriEnhanceTransport } from '@/assistant/enhance/tauri-enhance-transport.js';
import { reposOrNull } from '@/data/adapters.js';
import {
  type CreateLoopInput,
  type LoopCompileInput,
  type LoopCompileModel,
  type LoopCompileResult,
  type LoopModelOutput,
  type LoopDefinitionRow,
  type LoopService,
  type LoopServiceRepos,
  type RuntimeRepositories,
  type SaveRevisionInput,
  type SaveRevisionResult,
  createLoopService,
  generateId,
  getCompilerProfile,
} from '@offisim/core/browser';
import type { LoopDefinition, LoopRevision } from '@offisim/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Renderer data layer over the Loop domain (PR-07 service). PR-08 (this PR) adds
 * the authoring write paths (create / save revision / select / archive /
 * duplicate) plus the REAL compile model adapter; PR-10 needs the read paths
 * (list loops for the `/loop` picker, get a revision to validate "ready" at
 * insert + Send). The single writer of loop_invocations lives in the send-time
 * materializer, not here. Mirrors missions.ts: `reposOrNull()` is the one door to
 * the SQLite-backed repos; browser preview returns empty (loops are a
 * real-backend-only surface). The LoopService model is INJECTED only on save — the
 * read paths and `getRevision` PR-10 uses never compile, so no model is needed.
 */

function loopServiceRepos(repos: RuntimeRepositories): LoopServiceRepos | null {
  const { loopDefinitions, loopRevisions, loopSkillBindings, loopInvocations } = repos;
  if (!loopDefinitions || !loopRevisions || !loopSkillBindings || !loopInvocations) return null;
  return { loopDefinitions, loopRevisions, loopSkillBindings, loopInvocations };
}

function toLoopDefinition(row: LoopDefinitionRow): LoopDefinition {
  return {
    loopId: row.loop_id,
    companyId: row.company_id,
    title: row.title,
    summary: row.summary,
    profileId: row.profile_id,
    currentRevisionId: row.current_revision_id ?? undefined,
    status: row.status as LoopDefinition['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Build the Loop service over the live repos, or throw if unavailable (desktop-only). */
export function buildLoopService(repos: RuntimeRepositories): LoopService {
  const subset = loopServiceRepos(repos);
  if (!subset) throw new Error('Loop repositories are unavailable in this runtime.');
  return createLoopService(subset, {
    now: () => new Date().toISOString(),
    newId: () => generateId('loop'),
  });
}

const loopKeys = {
  list: (companyId: string | null) => ['loops', companyId] as const,
  detail: (loopId: string | null) => ['loop', loopId] as const,
  revisions: (loopId: string | null) => ['loop-revisions', loopId] as const,
  revision: (revisionId: string | null) => ['loop-revision', revisionId] as const,
};

// ---------------------------------------------------------------------------
// Real compile model adapter (PR-08): runEnhance(loop_design) → LoopModelOutput
// ---------------------------------------------------------------------------

/**
 * The REAL {@link LoopCompileModel} the renderer injects into
 * `LoopService.saveRevision`. The deterministic compiler (PR-07) calls this with a
 * {@link LoopCompileInput}; the adapter runs the PR-06 `loop_design` enhance over
 * the source prompt and maps the result to a {@link LoopModelOutput}:
 *
 *   - `enhancedPrompt` ← the enhance's `result.enhanced` (the cleaned NL prose),
 *   - `structuredHints` ← the enhance's `result.structuredHints` (inferred
 *     outcome / budget / clarifying questions — never raw evaluator JSON).
 *
 * The compiler treats every field as UNTRUSTED and deterministically repairs or
 * rejects it, so a bad enhance produces an `invalid`/`needs_input` revision, never
 * a crash. The enhance is the ONLY place a model is touched on the loop save path;
 * the compile/validate/≤3-question/packet layer stays deterministic and Pi-free.
 *
 * `answers` (prior clarifying-question responses, supplied on a recompile) are fed
 * to the enhance as a `feedback` steer so the model can resolve what it asked.
 */
function createLoopCompileModel(opts?: {
  /** Honor a conversation's model/thinking override (cosmetic for enhance). */
  threadId?: string;
  locale?: string;
}): LoopCompileModel {
  const transport = createTauriEnhanceTransport(
    opts?.threadId ? { threadId: opts.threadId } : undefined,
  );
  return async (input: LoopCompileInput): Promise<LoopModelOutput> => {
    // Prefer an already-enhanced prompt when one was applied in the composer; the
    // compiler still re-derives structured hints from a fresh enhance so the IR
    // reflects the latest text. The source the model reads is the enhanced prose
    // if present, else the raw source.
    const baseText = input.enhancedPrompt?.trim() || input.sourcePrompt;
    const answerSteer = input.answers
      ? Object.entries(input.answers)
          .map(([id, answer]) => `${id}: ${answer}`)
          .join('\n')
      : '';
    const request = buildEnhanceRequest({
      profile: 'loop_design',
      text: baseText,
      locale: opts?.locale ?? 'en',
      protectedSpans: [],
      context: {
        companyId: input.context.companyId,
        ...(input.context.projectId ? { projectId: input.context.projectId } : {}),
        ...(input.context.repository ? { repository: input.context.repository } : {}),
      },
      ...(answerSteer ? { feedback: `Resolve these clarifications:\n${answerSteer}` } : {}),
    });
    const result = await runEnhance(request, transport);
    return {
      enhancedPrompt: result.enhanced,
      ...(result.structuredHints ? { structuredHints: result.structuredHints } : {}),
    };
  };
}

/** All loops for a company — feeds the `/loop` searchable picker. */
export function useLoops(companyId: string | null) {
  return useQuery<LoopDefinition[]>({
    queryKey: loopKeys.list(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const repos = await reposOrNull();
      if (!repos) return [];
      const subset = loopServiceRepos(repos);
      if (!subset) return [];
      return buildLoopService(repos).listLoops(companyId, { limit: 200 });
    },
    enabled: companyId !== null,
  });
}

/** Read a single revision (used to surface a `vN+1 available` badge on a chip). */
export async function getLoopRevision(revisionId: string): Promise<LoopRevision | null> {
  const repos = await reposOrNull();
  if (!repos) return null;
  const subset = loopServiceRepos(repos);
  if (!subset) return null;
  try {
    return await buildLoopService(repos).getRevision(revisionId);
  } catch {
    return null;
  }
}

/** Read a loop definition (for its current revision id — the "newer available" check). */
export async function getLoopDefinition(loopId: string): Promise<LoopDefinition | null> {
  const repos = await reposOrNull();
  if (!repos) return null;
  const subset = loopServiceRepos(repos);
  if (!subset) return null;
  try {
    return await buildLoopService(repos).getLoop(loopId);
  } catch {
    return null;
  }
}

/**
 * Compile a PREVIEW without persisting (PR-08). Runs the profile's deterministic
 * `compile` over the REAL loop_design model — the same compile the service would
 * persist — but writes NOTHING. This drives the `compiling → ready/needs_input/
 * invalid` editor states; Save (a separate explicit action) is what persists an
 * immutable revision. The compiler never throws on bad model output (returns
 * `invalid`); a thrown error here means infrastructure (no model / network).
 */
export async function compileLoopPreview(input: {
  profileId: string;
  compileInput: LoopCompileInput;
  threadId?: string;
}): Promise<LoopCompileResult> {
  const profile = getCompilerProfile(input.profileId);
  if (!profile) throw new Error(`Compiler profile ${input.profileId} not found.`);
  const model = createLoopCompileModel(input.threadId ? { threadId: input.threadId } : undefined);
  return profile.compile(input.compileInput, model);
}

// ---------------------------------------------------------------------------
// Reads (PR-08 authoring): single loop + its revision history
// ---------------------------------------------------------------------------

/** A single loop definition (its title/summary/status/current revision). */
export function useLoop(loopId: string | null) {
  return useQuery<LoopDefinition | null>({
    queryKey: loopKeys.detail(loopId),
    queryFn: async () => {
      if (!loopId) return null;
      return getLoopDefinition(loopId);
    },
    enabled: loopId !== null,
  });
}

/** All revisions of a loop, newest-first (the version menu / picker). */
export function useLoopRevisions(loopId: string | null) {
  return useQuery<LoopRevision[]>({
    queryKey: loopKeys.revisions(loopId),
    queryFn: async () => {
      if (!loopId) return [];
      const repos = await reposOrNull();
      if (!repos) return [];
      const subset = loopServiceRepos(repos);
      if (!subset) return [];
      const list = await buildLoopService(repos).listRevisions(loopId);
      return [...list].sort((a, b) => b.revisionNumber - a.revisionNumber);
    },
    enabled: loopId !== null,
  });
}

// ---------------------------------------------------------------------------
// Writes (PR-08 authoring) — every mutation invalidates the affected queries
// ---------------------------------------------------------------------------

/** Create a new (empty) Loop definition under a profile. */
export function useCreateLoop(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateLoopInput, 'companyId'>): Promise<LoopDefinition> => {
      if (!companyId) throw new Error('Creating a Loop needs a selected company.');
      const repos = await reposOrNull();
      if (!repos) throw new Error('Creating a Loop needs the desktop app.');
      return buildLoopService(repos).createLoop({ companyId, ...input });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loopKeys.list(companyId) });
    },
  });
}

/**
 * Persist natural-language draft metadata before the user leaves an uncompiled Loop.
 *
 * This intentionally writes only loop_definitions.summary. It does not create a
 * revision, run the compiler, select a current revision, or touch Mission/runtime
 * tables; immutable revision history still starts at explicit Compile + Save.
 */
export function useUpdateLoopDraftSummary(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { loopId: string; summary: string }): Promise<LoopDefinition> => {
      if (!companyId) throw new Error('Updating a Loop draft needs a selected company.');
      const repos = await reposOrNull();
      if (!repos) throw new Error('Updating a Loop draft needs the desktop app.');
      const subset = loopServiceRepos(repos);
      if (!subset) throw new Error('Loop repositories are unavailable in this runtime.');

      const row = await subset.loopDefinitions.findById(input.loopId);
      if (!row || row.company_id !== companyId) throw new Error('Loop not found.');

      const updatedAt = new Date().toISOString();
      await subset.loopDefinitions.update(input.loopId, {
        summary: input.summary,
        updatedAt,
      });
      return toLoopDefinition({ ...row, summary: input.summary, updated_at: updatedAt });
    },
    onSuccess: (updated) => {
      qc.setQueryData(loopKeys.detail(updated.loopId), updated);
      qc.setQueryData<LoopDefinition[] | undefined>(loopKeys.list(companyId), (rows) =>
        rows?.map((row) => (row.loopId === updated.loopId ? updated : row)),
      );
    },
  });
}

/**
 * Compile + persist a NEW immutable revision (never overwrites). The REAL
 * loop_design enhance model is injected here — this is the one place the model is
 * touched on save. Invalidates the loop, its revisions, and the company list.
 */
export function useSaveLoopRevision(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: SaveRevisionInput & { threadId?: string },
    ): Promise<SaveRevisionResult> => {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Saving a Loop revision needs the desktop app.');
      const { threadId, ...saveInput } = input;
      const model = createLoopCompileModel(threadId ? { threadId } : undefined);
      return buildLoopService(repos).saveRevision(saveInput, model);
    },
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: loopKeys.detail(vars.loopId) });
      qc.invalidateQueries({ queryKey: loopKeys.revisions(vars.loopId) });
      qc.invalidateQueries({ queryKey: loopKeys.list(companyId) });
    },
  });
}

/** Point a loop's current revision at an older/newer revision (new pointer only). */
export function useSelectLoopRevision(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { loopId: string; revisionId: string }): Promise<LoopDefinition> => {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Selecting a Loop revision needs the desktop app.');
      return buildLoopService(repos).selectRevision(input.loopId, input.revisionId);
    },
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: loopKeys.detail(vars.loopId) });
      // The editor re-hydrates from `revisions.data` keyed by the new current id;
      // without this the re-hydration reads a stale list and flickers back.
      qc.invalidateQueries({ queryKey: loopKeys.revisions(vars.loopId) });
      qc.invalidateQueries({ queryKey: loopKeys.list(companyId) });
    },
  });
}

/** Archive a loop (the default delete — never physically removes history). */
export function useArchiveLoop(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loopId: string): Promise<LoopDefinition> => {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Archiving a Loop needs the desktop app.');
      return buildLoopService(repos).archiveLoop(loopId);
    },
    onSuccess: (_result, _loopId) => {
      qc.invalidateQueries({ queryKey: loopKeys.list(companyId) });
    },
  });
}

/**
 * Duplicate a loop: create a fresh definition (same profile, "(copy)" title) and
 * carry its CURRENT revision's source/enhanced prompt into a first revision so the
 * copy compiles to the same shape. Returns the new loop id.
 */
export function useDuplicateLoop(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loop: LoopDefinition): Promise<LoopDefinition> => {
      if (!companyId) throw new Error('Duplicating a Loop needs a selected company.');
      const repos = await reposOrNull();
      if (!repos) throw new Error('Duplicating a Loop needs the desktop app.');
      const service = buildLoopService(repos);
      const copy = await service.createLoop({
        companyId,
        title: `${loop.title} (copy)`,
        summary: loop.summary,
        profileId: loop.profileId,
      });
      // Carry the source prompt of the original's current revision (if any) so the
      // copy starts from the same intent. A copy with no compiled revision stays a
      // pure draft — the user opens it and compiles.
      if (loop.currentRevisionId) {
        const src = await service.getRevision(loop.currentRevisionId).catch(() => null);
        if (src) {
          const model = createLoopCompileModel();
          await service.saveRevision(
            {
              loopId: copy.loopId,
              sourcePrompt: src.sourcePrompt,
              ...(src.enhancedPrompt ? { enhancedPrompt: src.enhancedPrompt } : {}),
              context: { companyId },
            },
            model,
          );
        }
      }
      return copy;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loopKeys.list(companyId) });
    },
  });
}
