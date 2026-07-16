/**
 * Loop domain — core barrel (PR-07). The public compiler/service/adapter surface
 * PR-08 (Prompt-first UI), PR-09 (graph panel), and PR-10 (Office Send) consume.
 * Renderer- and Pi-free: the model is injected at the call site.
 */

export {
  LOOP_COMPILER_VERSION,
  LOOP_LIMITS,
} from './types.js';
export type {
  LoopCompileContext,
  LoopCompileInput,
  LoopCompileModel,
  LoopCompileResult,
  LoopCompilerProfile,
  LoopModelOutput,
  CompilerAsset,
  ValidationFinding,
} from './types.js';

export { validateLoopIR } from './validate.js';
export { defaultBudgetForTier, repairOrReject } from './repair.js';
export type { RepairOutcome } from './repair.js';

export {
  DEFAULT_COMPILER_PROFILE_ID,
  getCompilerProfile,
  listCompilerProfiles,
  GENERAL_WORK_PROFILE_ID,
  generalWorkProfile,
  SOFTWARE_DEVELOPMENT_PROFILE_ID,
  softwareDevelopmentProfile,
} from './compiler-profiles/index.js';
export { FLEET_DEVELOPMENT_LOOP_VERSION } from './compiler-profiles/software-development/assets.js';

export { buildLoopExecutionPacket } from './mission-adapter.js';
export type {
  LoopExecutionPacket,
  CompiledMissionCriterion,
  PacketSkillBinding,
} from './mission-adapter.js';

export {
  createLoopService,
  LoopServiceError,
} from './loop-service.js';
export type {
  LoopService,
  LoopServiceRepos,
  LoopServiceDeps,
  CreateLoopInput,
  SaveRevisionInput,
  SaveCompiledRevisionInput,
  SaveRevisionResult,
  SaveLoopSkill,
} from './loop-service.js';
