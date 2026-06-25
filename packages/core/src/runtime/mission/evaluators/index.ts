/**
 * Mission Evaluator subsystem barrel (PRD §20, slice MS-003).
 *
 * Re-exported from `@offisim/core/browser` so MS-004 + the harness can consume
 * the evaluator contract, registry, and P0 builtins through the public entry.
 * Evaluators are pure logic over an injected capability context (no node fs /
 * shell / git), so they are browser-safe.
 */

export type {
  EvaluationContext,
  EvaluationResult,
  EvaluationVerdict,
  MissionEvaluator,
} from './types.js';
export {
  createEvaluatorRegistry,
  createDefaultEvaluatorRegistry,
  UnknownEvaluatorError,
} from './registry.js';
export type { EvaluatorRegistry } from './registry.js';
export { BUILTIN_EVALUATORS } from './builtin.js';
