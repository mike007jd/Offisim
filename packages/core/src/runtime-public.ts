// `@offisim/core/runtime` — Node-side runtime helpers shared by the desktop
// shell. AI execution is owned by the Pi Agent host, not this package.
export { HookRegistry } from './runtime/hook-registry.js';
export { createRuntimeContext, disposeRuntime } from './runtime/runtime-context.js';
export { Scratchpad } from './runtime/scratchpad.js';
export {
  decideBoundedLoop,
  stableFailureSignature,
} from './runtime/bounded-loop.js';
export type {
  BoundedLoopDecision,
  BoundedLoopDecisionInput,
  BoundedLoopStopReason,
  LoopFailureFact,
} from './runtime/bounded-loop.js';

export {
  buildSkillUpdateValues,
  coerceSkillScope,
  coerceSkillSourceKind,
  rowToSkill,
  assertSkillScopeConsistency,
  skillToDbRow,
} from './runtime/repos/skills/shared.js';
export type { SkillDbRow } from './runtime/repos/skills/shared.js';
export type { RuntimeContext, DisposableRuntime } from './runtime/runtime-context.js';
export type { RuntimeRepositories } from './runtime/repositories.js';
