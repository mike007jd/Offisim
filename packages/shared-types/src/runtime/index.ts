/**
 * Agent Runtime Driver SPI (PRD §15) — the neutral, vendor-agnostic contract a
 * runtime is certified against (RD-001), plus the in-repo model-free reference
 * implementation (RD-005). Parallel to and additive over the existing
 * {@link ../events/agent-run} delegation contract.
 */

export type {
  AgentRuntimeDriver,
  RuntimeCapabilities,
  RuntimeDescriptor,
  RuntimeEventEnvelope,
  RuntimeEventSink,
  RuntimeEventType,
  RuntimeInteraction,
  RuntimeInteractionAnswer,
  RuntimeInteractionMode,
  RuntimeResumeReference,
  RuntimeResumeRequest,
  RuntimeRunHandle,
  RuntimeRunReference,
  RuntimeRunRequest,
} from './driver.js';

export type {
  DeterministicScript,
  DeterministicTestDriverOptions,
  ScriptAwaitInteractionStep,
  ScriptCrashStep,
  ScriptEmitStep,
  ScriptStep,
  ScriptTerminal,
} from './deterministic-test-driver.js';
export {
  createDeterministicTestDriver,
  DeterministicTestDriver,
  DETERMINISTIC_TEST_CAPABILITIES,
} from './deterministic-test-driver.js';
