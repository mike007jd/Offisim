/**
 * pi-bridge — the layer that runs Offisim workers on the vendored pi agent loop
 * (`@offisim/pi-agent` / `@offisim/pi-ai`) in place of the LangGraph
 * orchestration. Coexists with the old graph until the Phase 6 cut-over.
 */

export { PiAgentRegistry } from './pi-agent-registry.js';
export { createBudgetTransform, type PiBudgetDeps } from './pi-budget.js';
export {
  createPiEventListener,
  type PiEventBridgeHandlers,
  type PiEventIdentity,
} from './pi-event-bridge.js';
export { buildPiModel, laneToPiApi, type PiModelInput } from './pi-model.js';
export {
  llmToPiMessages,
  piToLlmMessage,
  piToLlmMessages,
} from './pi-message-convert.js';
export {
  PiOrchestrationService,
  type PiAgentKind,
  type PiExecuteInput,
  type PiExecuteResult,
  type PiModelMeta,
  type PiOrchestrationDeps,
} from './pi-orchestration-service.js';
export { createPiStreamFn, type PiStreamDeps, TAURI_MANAGED_API_KEY } from './pi-stream.js';
export {
  type PiToolContext,
  toolDefsToAgentTools,
  toolDefToAgentTool,
} from './pi-tool-adapter.js';
