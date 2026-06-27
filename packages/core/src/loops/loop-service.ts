/**
 * Loop service (PR-07). The application-facing API PR-08/09/10 consume: create a
 * Loop, compile + save an immutable revision, select a revision, archive vs delete.
 *
 * INVARIANTS this service owns:
 *   - SAVING a Loop writes ONLY loop_definitions / loop_revisions /
 *     loop_skill_bindings — NEVER a mission / chat_thread / attempt / run.
 *   - Revisions are INSERT-ONLY and monotonically numbered per loop; the
 *     UNIQUE(loop_id, revision_number) index is the concurrency authority.
 *   - Deleting a definition DEFAULTS to archive; a physical delete is refused when
 *     the loop has invocation history.
 *
 * The compiler's `model` is INJECTED at the call site (the renderer wires the real
 * loop_design enhance; the harness scripts a fake), so this service is renderer-
 * and Pi-free.
 */

import type {
  LoopCompileQuestion,
  LoopDefinition,
  LoopIR,
  LoopRevision,
  LoopSkillBinding,
  LoopValidation,
} from '@offisim/shared-types';
import type {
  LoopDefinitionRepository,
  LoopDefinitionRow,
  LoopInvocationRepository,
  LoopRevisionRepository,
  LoopRevisionRow,
  LoopSkillBindingRepository,
} from '../runtime/repositories.js';
import { getCompilerProfile } from './compiler-profiles/index.js';
import { LOOP_COMPILER_VERSION, LOOP_LIMITS } from './types.js';
import type { LoopCompileInput, LoopCompileModel } from './types.js';

export class LoopServiceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'profile_not_found'
      | 'loop_not_found'
      | 'revision_not_found'
      | 'invocation_history'
      | 'ir_too_large'
      | 'concurrent_save',
  ) {
    super(message);
    this.name = 'LoopServiceError';
  }
}

export interface LoopServiceRepos {
  loopDefinitions: LoopDefinitionRepository;
  loopRevisions: LoopRevisionRepository;
  loopSkillBindings: LoopSkillBindingRepository;
  loopInvocations: LoopInvocationRepository;
}

export interface LoopServiceDeps {
  newId: () => string;
  /** ISO-8601 now(). */
  now: () => string;
}

export interface CreateLoopInput {
  companyId: string;
  title: string;
  summary?: string;
  /** Compiler profile id; defaults to software-development if omitted. */
  profileId: string;
}

/** A skill the caller wants bound to the saved revision. */
export interface SaveLoopSkill {
  skillId: string;
  skillVersion: string;
  config?: Record<string, unknown>;
}

export interface SaveRevisionInput {
  loopId: string;
  sourcePrompt: string;
  enhancedPrompt?: string;
  context: LoopCompileInput['context'];
  answers?: Record<string, string>;
  /** Skills to bind to the new revision (ordered as supplied). */
  skills?: SaveLoopSkill[];
  /** When the saved revision is `ready`, also select it as the current revision. */
  selectIfReady?: boolean;
}

/** The result of a save: the persisted revision row + its decoded status payload. */
export interface SaveRevisionResult {
  revision: LoopRevision;
  status: LoopRevision['compileStatus'];
  questions: LoopCompileQuestion[];
  validation: LoopValidation;
  /** Present iff status === 'ready'. The validated IR (also serialized on the row). */
  ir?: LoopIR;
}

function toDefinition(row: LoopDefinitionRow): LoopDefinition {
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

function toRevision(row: LoopRevisionRow): LoopRevision {
  return {
    revisionId: row.revision_id,
    loopId: row.loop_id,
    revisionNumber: row.revision_number,
    sourcePrompt: row.source_prompt,
    enhancedPrompt: row.enhanced_prompt ?? undefined,
    compiledIrJson: row.compiled_ir_json,
    compilerProfileId: row.compiler_profile_id,
    compilerProfileVersion: row.compiler_profile_version,
    compilerVersion: row.compiler_version,
    compileStatus: row.compile_status as LoopRevision['compileStatus'],
    questionsJson: row.questions_json,
    validationJson: row.validation_json,
    createdAt: row.created_at,
  };
}

export interface LoopService {
  createLoop(input: CreateLoopInput): Promise<LoopDefinition>;
  getLoop(loopId: string): Promise<LoopDefinition>;
  listLoops(companyId: string, opts?: { limit?: number }): Promise<LoopDefinition[]>;
  /** Compile + persist an immutable revision. Writes ONLY loop tables. */
  saveRevision(input: SaveRevisionInput, model: LoopCompileModel): Promise<SaveRevisionResult>;
  listRevisions(loopId: string): Promise<LoopRevision[]>;
  getRevision(revisionId: string): Promise<LoopRevision>;
  listSkillBindings(revisionId: string): Promise<LoopSkillBinding[]>;
  /** Point the definition's current_revision_id at a ready/draft revision. */
  selectRevision(loopId: string, revisionId: string): Promise<LoopDefinition>;
  /** Archive (default) — never physically deletes a revision with history. */
  archiveLoop(loopId: string): Promise<LoopDefinition>;
  /**
   * Physically delete the definition (cascades revisions+bindings). REFUSED when
   * the loop has invocation history — callers should archive instead.
   */
  deleteLoop(loopId: string): Promise<void>;
}

export function createLoopService(repos: LoopServiceRepos, deps: LoopServiceDeps): LoopService {
  async function requireLoop(loopId: string): Promise<LoopDefinitionRow> {
    const row = await repos.loopDefinitions.findById(loopId);
    if (!row) throw new LoopServiceError(`loop ${loopId} not found`, 'loop_not_found');
    return row;
  }

  return {
    async createLoop(input) {
      const profile = getCompilerProfile(input.profileId);
      if (!profile) {
        throw new LoopServiceError(
          `compiler profile ${input.profileId} not found`,
          'profile_not_found',
        );
      }
      const ts = deps.now();
      const row: LoopDefinitionRow = {
        loop_id: deps.newId(),
        company_id: input.companyId,
        title: input.title,
        summary: input.summary ?? '',
        profile_id: input.profileId,
        current_revision_id: null,
        status: 'draft',
        created_at: ts,
        updated_at: ts,
      };
      await repos.loopDefinitions.insert(row);
      return toDefinition(row);
    },

    async getLoop(loopId) {
      return toDefinition(await requireLoop(loopId));
    },

    async listLoops(companyId, opts) {
      const rows = await repos.loopDefinitions.listByCompany(companyId, opts);
      return rows.map(toDefinition);
    },

    async saveRevision(input, model) {
      const loop = await requireLoop(input.loopId);
      const profile = getCompilerProfile(loop.profile_id);
      if (!profile) {
        throw new LoopServiceError(
          `compiler profile ${loop.profile_id} not found`,
          'profile_not_found',
        );
      }

      // Compile (deterministic over an injected model). The compiler never throws.
      const compileInput: LoopCompileInput = {
        sourcePrompt: input.sourcePrompt,
        ...(input.enhancedPrompt ? { enhancedPrompt: input.enhancedPrompt } : {}),
        context: input.context,
        ...(input.answers ? { answers: input.answers } : {}),
      };
      const result = await profile.compile(compileInput, model);

      // Serialize the IR (or an empty placeholder for needs_input/invalid). Guard
      // the IR size so a runaway model output cannot bloat a revision row.
      const irJson = result.ir ? JSON.stringify(result.ir) : '{}';
      if (Buffer.byteLength(irJson, 'utf8') > LOOP_LIMITS.maxCompiledIrBytes) {
        throw new LoopServiceError('compiled IR exceeds the size limit', 'ir_too_large');
      }

      // The side JSON columns are bounded too: questions are capped at ≤3 but a
      // pathological validation (hundreds of findings) could still bloat the row.
      // Reject an oversized serialization rather than persisting unbounded blobs.
      const questionsJson = JSON.stringify(result.questions);
      if (Buffer.byteLength(questionsJson, 'utf8') > LOOP_LIMITS.maxQuestionsBytes) {
        throw new LoopServiceError('compiled questions exceed the size limit', 'ir_too_large');
      }
      const validationJson = JSON.stringify(result.validation);
      if (Buffer.byteLength(validationJson, 'utf8') > LOOP_LIMITS.maxValidationBytes) {
        throw new LoopServiceError('compiled validation exceeds the size limit', 'ir_too_large');
      }

      const ts = deps.now();
      // Monotonic numbering: next = max + 1. The UNIQUE index is the real authority
      // under concurrency; a clash surfaces as the repo insert throwing, which we
      // translate to `concurrent_save` so the caller can retry.
      const nextNumber = (await repos.loopRevisions.maxRevisionNumber(input.loopId)) + 1;
      const revisionId = deps.newId();
      const revisionRow: LoopRevisionRow = {
        revision_id: revisionId,
        loop_id: input.loopId,
        revision_number: nextNumber,
        source_prompt: input.sourcePrompt,
        enhanced_prompt: result.enhancedPrompt ?? input.enhancedPrompt ?? null,
        compiled_ir_json: irJson,
        compiler_profile_id: profile.id,
        compiler_profile_version: profile.version,
        compiler_version: LOOP_COMPILER_VERSION,
        compile_status: result.status,
        questions_json: questionsJson,
        validation_json: validationJson,
        created_at: ts,
      };
      try {
        await repos.loopRevisions.insert(revisionRow);
      } catch (error) {
        throw new LoopServiceError(
          `concurrent save lost the revision-number race: ${error instanceof Error ? error.message : String(error)}`,
          'concurrent_save',
        );
      }

      // Bind skills to THIS revision (immutable with it). Order as supplied.
      if (input.skills && input.skills.length > 0) {
        for (let i = 0; i < input.skills.length; i += 1) {
          const s = input.skills[i]!;
          await repos.loopSkillBindings.insert({
            binding_id: deps.newId(),
            revision_id: revisionId,
            skill_id: s.skillId,
            skill_version: s.skillVersion,
            order_index: i,
            config_json: JSON.stringify(s.config ?? {}),
          });
        }
      }

      // Select + flip the definition to `ready` when the revision is ready. This is
      // a loop_definitions UPDATE only — still NO mission/thread write.
      const selectIfReady = input.selectIfReady !== false;
      if (result.status === 'ready' && selectIfReady) {
        await repos.loopDefinitions.update(input.loopId, {
          currentRevisionId: revisionId,
          status: 'ready',
          updatedAt: ts,
        });
      } else {
        await repos.loopDefinitions.update(input.loopId, { updatedAt: ts });
      }

      return {
        revision: toRevision(revisionRow),
        status: result.status,
        questions: result.questions,
        validation: result.validation,
        ...(result.ir ? { ir: result.ir } : {}),
      };
    },

    async listRevisions(loopId) {
      const rows = await repos.loopRevisions.listByLoop(loopId);
      return rows.map(toRevision);
    },

    async getRevision(revisionId) {
      const row = await repos.loopRevisions.findById(revisionId);
      if (!row)
        throw new LoopServiceError(`revision ${revisionId} not found`, 'revision_not_found');
      return toRevision(row);
    },

    async listSkillBindings(revisionId) {
      const rows = await repos.loopSkillBindings.listByRevision(revisionId);
      return rows.map((r) => ({
        bindingId: r.binding_id,
        revisionId: r.revision_id,
        skillId: r.skill_id,
        skillVersion: r.skill_version,
        orderIndex: r.order_index,
        configJson: r.config_json,
      }));
    },

    async selectRevision(loopId, revisionId) {
      const loop = await requireLoop(loopId);
      const revision = await repos.loopRevisions.findById(revisionId);
      if (!revision || revision.loop_id !== loopId) {
        throw new LoopServiceError(
          `revision ${revisionId} not found for loop ${loopId}`,
          'revision_not_found',
        );
      }
      const ts = deps.now();
      // A ready revision flips the loop to ready; otherwise keep it as draft.
      const nextStatus = revision.compile_status === 'ready' ? 'ready' : loop.status;
      await repos.loopDefinitions.update(loopId, {
        currentRevisionId: revisionId,
        status: nextStatus,
        updatedAt: ts,
      });
      return toDefinition({
        ...loop,
        current_revision_id: revisionId,
        status: nextStatus,
        updated_at: ts,
      });
    },

    async archiveLoop(loopId) {
      const loop = await requireLoop(loopId);
      const ts = deps.now();
      await repos.loopDefinitions.update(loopId, { status: 'archived', updatedAt: ts });
      return toDefinition({ ...loop, status: 'archived', updated_at: ts });
    },

    async deleteLoop(loopId) {
      await requireLoop(loopId);
      // Never physically delete a definition that has invocation history — archive
      // instead so the history (and its revisions) stays readable.
      const invocations = await repos.loopInvocations.countByLoop(loopId);
      if (invocations > 0) {
        throw new LoopServiceError(
          `loop ${loopId} has ${invocations} invocation(s); archive instead of deleting`,
          'invocation_history',
        );
      }
      await repos.loopDefinitions.delete(loopId);
    },
  };
}
