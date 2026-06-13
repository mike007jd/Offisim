// `@offisim/core/runtime` — Node-side runtime surface (pi agent-loop kernel +
// runtime context). The LangGraph orchestration, its checkpoint savers, and the
// @langchain re-exports were removed in the pi-kernel cut-over (P6).
export { HookRegistry } from './runtime/hook-registry.js';
export { createRuntimeContext, disposeRuntime } from './runtime/runtime-context.js';
export { Scratchpad } from './runtime/scratchpad.js';

// --- pi-bridge (pi agent-loop kernel; replaces LangGraph orchestration) ---
export {
  buildPiModel,
  createPiStreamFn,
  createSkillInstallTools,
  createSubmitDeliverableTool,
  PiAgentRegistry,
  PiMessageStore,
  type PiAgentKind,
  type PiExecuteInput,
  type PiExecuteResult,
  type PiModelMeta,
  PiOrchestrationService,
  type PiOrchestrationDeps,
  type PiToolContext,
} from './pi-bridge/index.js';

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
