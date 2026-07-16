/**
 * Application-facing Loop service: create a Loop, generate a preview, save an
 * immutable revision, select a revision, and archive or delete the definition.
 *
 * INVARIANTS this service owns:
 *   - SAVING a Loop writes ONLY loop_definitions / loop_revisions /
 *     loop_skill_bindings — NEVER a mission / chat_thread / attempt / run.
 *   - Revisions are INSERT-ONLY and monotonically numbered per loop; the
 *     UNIQUE(loop_id, revision_number) index is the concurrency authority.
 *   - Deleting a definition DEFAULTS to archive; a physical delete is refused when
 *     the loop has invocation history.
 *
 * The preview compiler's `model` is injected at the call site (the renderer wires
 * the real loop_design enhance; the harness scripts a fake), so this service is
 * renderer- and runtime-free. Saving an existing preview is deterministic.
 */

import type {
  LoopCompileQuestion,
  LoopDefinition,
  LoopIR,
  LoopRevision,
  LoopScheduleIntervalMinutes,
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
import type { LoopCompileInput, LoopCompileModel, LoopCompileResult } from './types.js';

const UTF8_ENCODER = new TextEncoder();

function byteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

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
  /** Compiler profile id, normally `general-work` for new Loops. */
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

/** Persist the exact compile result the user already reviewed. No model call occurs. */
export interface SaveCompiledRevisionInput
  extends Pick<
    SaveRevisionInput,
    'loopId' | 'sourcePrompt' | 'enhancedPrompt' | 'skills' | 'selectIfReady'
  > {
  compiled: LoopCompileResult;
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
    ...(row.schedule_interval_minutes
      ? { scheduleIntervalMinutes: row.schedule_interval_minutes as LoopScheduleIntervalMinutes }
      : {}),
    ...(row.next_run_at ? { nextRunAt: row.next_run_at } : {}),
    ...(row.last_run_at ? { lastRunAt: row.last_run_at } : {}),
    ...(row.last_run_result ? { lastRunResult: row.last_run_result } : {}),
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
  /** Persist a previously compiled preview byte-for-byte. Never calls a model. */
  saveCompiledRevision(input: SaveCompiledRevisionInput): Promise<SaveRevisionResult>;
  listRevisions(loopId: string): Promise<LoopRevision[]>;
  getRevision(revisionId: string): Promise<LoopRevision>;
  listSkillBindings(revisionId: string): Promise<LoopSkillBinding[]>;
  /** Point the definition's current_revision_id at a ready/draft revision. */
  selectRevision(loopId: string, revisionId: string): Promise<LoopDefinition>;
  /** Archive (default) — never physically deletes a revision with history. */
  archiveLoop(loopId: string): Promise<LoopDefinition>;
  /** Null returns the Loop to manual-only. A configured schedule starts one
   * interval from now; there is deliberately no zero/default schedule. */
  configureSchedule(
    loopId: string,
    intervalMinutes: LoopScheduleIntervalMinutes | null,
  ): Promise<LoopDefinition>;
  /** Advance a missed schedule without running it (app hidden/not running). */
  skipMissedSchedule(loopId: string): Promise<LoopDefinition>;
  /** Atomically claim one exact due slot and advance it before side effects. */
  claimScheduledRun(loopId: string, expectedNextRunAt: string): Promise<boolean>;
  /** Persist the result for an already-claimed automatic run. */
  completeScheduledRun(loopId: string, result: string): Promise<LoopDefinition>;
  /**
   * Physically delete the definition (cascades revisions+bindings). REFUSED when
   * the loop has invocation history — callers should archive instead.
   */
  deleteLoop(loopId: string): Promise<void>;
}

export function createLoopService(repos: LoopServiceRepos, deps: LoopServiceDeps): LoopService {
  const scheduleIntervals = new Set<number>([15, 60, 360, 1440]);
  const nextRunAt = (now: string, minutes: number): string =>
    new Date(Date.parse(now) + minutes * 60_000).toISOString();
  async function requireLoop(loopId: string): Promise<LoopDefinitionRow> {
    const row = await repos.loopDefinitions.findById(loopId);
    if (!row) throw new LoopServiceError(`loop ${loopId} not found`, 'loop_not_found');
    return row;
  }

  async function persistCompiledRevision(
    input: SaveCompiledRevisionInput,
  ): Promise<SaveRevisionResult> {
    const loop = await requireLoop(input.loopId);
    const profile = getCompilerProfile(loop.profile_id);
    if (!profile) {
      throw new LoopServiceError(
        `compiler profile ${loop.profile_id} not found`,
        'profile_not_found',
      );
    }

    const result = input.compiled;
    const irJson = result.ir ? JSON.stringify(result.ir) : '{}';
    if (byteLength(irJson) > LOOP_LIMITS.maxCompiledIrBytes) {
      throw new LoopServiceError('compiled IR exceeds the size limit', 'ir_too_large');
    }
    const questionsJson = JSON.stringify(result.questions);
    if (byteLength(questionsJson) > LOOP_LIMITS.maxQuestionsBytes) {
      throw new LoopServiceError('compiled questions exceed the size limit', 'ir_too_large');
    }
    const validationJson = JSON.stringify(result.validation);
    if (byteLength(validationJson) > LOOP_LIMITS.maxValidationBytes) {
      throw new LoopServiceError('compiled validation exceeds the size limit', 'ir_too_large');
    }

    const ts = deps.now();
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

    for (const [index, skill] of (input.skills ?? []).entries()) {
      await repos.loopSkillBindings.insert({
        binding_id: deps.newId(),
        revision_id: revisionId,
        skill_id: skill.skillId,
        skill_version: skill.skillVersion,
        order_index: index,
        config_json: JSON.stringify(skill.config ?? {}),
      });
    }

    if (result.status === 'ready' && input.selectIfReady !== false) {
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
        schedule_interval_minutes: null,
        next_run_at: null,
        last_run_at: null,
        last_run_result: null,
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

      return persistCompiledRevision({
        loopId: input.loopId,
        sourcePrompt: input.sourcePrompt,
        ...(input.enhancedPrompt ? { enhancedPrompt: input.enhancedPrompt } : {}),
        ...(input.skills ? { skills: input.skills } : {}),
        ...(input.selectIfReady !== undefined ? { selectIfReady: input.selectIfReady } : {}),
        compiled: result,
      });
    },

    async saveCompiledRevision(input) {
      return persistCompiledRevision(input);
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

    async configureSchedule(loopId, intervalMinutes) {
      const loop = await requireLoop(loopId);
      if (intervalMinutes !== null && !scheduleIntervals.has(intervalMinutes)) {
        throw new Error(`Unsupported Loop schedule interval: ${intervalMinutes}`);
      }
      const ts = deps.now();
      const next = intervalMinutes === null ? null : nextRunAt(ts, intervalMinutes);
      await repos.loopDefinitions.update(loopId, {
        scheduleIntervalMinutes: intervalMinutes,
        nextRunAt: next,
        updatedAt: ts,
      });
      return toDefinition({
        ...loop,
        schedule_interval_minutes: intervalMinutes,
        next_run_at: next,
        updated_at: ts,
      });
    },

    async skipMissedSchedule(loopId) {
      const loop = await requireLoop(loopId);
      if (!loop.schedule_interval_minutes) return toDefinition(loop);
      const ts = deps.now();
      const next = nextRunAt(ts, loop.schedule_interval_minutes);
      await repos.loopDefinitions.update(loopId, { nextRunAt: next, updatedAt: ts });
      return toDefinition({ ...loop, next_run_at: next, updated_at: ts });
    },

    async claimScheduledRun(loopId, expectedNextRunAt) {
      const loop = await requireLoop(loopId);
      if (!loop.schedule_interval_minutes || loop.next_run_at !== expectedNextRunAt) return false;
      const claimedAt = deps.now();
      const next = nextRunAt(claimedAt, loop.schedule_interval_minutes);
      return repos.loopDefinitions.claimScheduledRun(loopId, expectedNextRunAt, {
        claimedAt,
        nextRunAt: next,
      });
    },

    async completeScheduledRun(loopId, result) {
      const loop = await requireLoop(loopId);
      const ts = deps.now();
      const normalizedResult = result.trim().slice(0, 240) || 'completed';
      await repos.loopDefinitions.update(loopId, {
        lastRunAt: ts,
        lastRunResult: normalizedResult,
        updatedAt: ts,
      });
      return toDefinition({
        ...loop,
        last_run_at: ts,
        last_run_result: normalizedResult,
        updated_at: ts,
      });
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
