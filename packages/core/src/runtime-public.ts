export { buildOffisimGraph } from './graph/main-graph.js';
export { createMemoryCheckpointSaver, withLoadLatest } from './graph/checkpoint-saver.js';
export type {
  LoadLatestCheckpointSaver,
  LatestCheckpointSnapshot,
} from './graph/checkpoint-saver.js';
// Re-export the LangGraph checkpoint base class + types so the desktop Tauri
// checkpoint saver can subclass it without taking a direct `@langchain/langgraph`
// dependency (this barrel already pulls LangGraph via `buildOffisimGraph`). The
// saver derives its method parameter types (CheckpointListOptions /
// ChannelVersions / PendingWrite) from `BaseCheckpointSaver` via `Parameters<>`,
// so only what LangGraph itself re-exports needs to ride here.
export { BaseCheckpointSaver } from '@langchain/langgraph';
export type { Checkpoint, CheckpointMetadata, CheckpointTuple } from '@langchain/langgraph';
// Re-export the LangChain message constructors graph callers need to seed
// `OrchestrationService.execute({ messages })`, so desktop wiring does not have
// to take a direct `@langchain/core` dependency. This barrel already pulls
// LangGraph via `buildOffisimGraph`, so this adds no new bundle weight.
export { HumanMessage, AIMessage } from '@langchain/core/messages';
export type { BaseMessage } from '@langchain/core/messages';
export { ensureYoloMasterForActiveCompanies } from './runtime/ensure-yolo-master.js';
export { HookRegistry } from './runtime/hook-registry.js';
export { ResumeCoordinator } from './runtime/resume-coordinator.js';
export { createRuntimeContext, disposeRuntime } from './runtime/runtime-context.js';
export { Scratchpad } from './runtime/scratchpad.js';

// --- pi-bridge (pi agent-loop kernel; replaces LangGraph orchestration) ---
export {
  buildPiModel,
  createPiStreamFn,
  createSubmitDeliverableTool,
  PiAgentRegistry,
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
export type { BuildGraphOptions } from './graph/main-graph.js';
export type { RuntimeContext, DisposableRuntime } from './runtime/runtime-context.js';
export type { RuntimeRepositories } from './runtime/repositories.js';
