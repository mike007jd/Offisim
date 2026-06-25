/**
 * Mission Playbook subsystem barrel (PRD §25, slice M6 / PB-001..004).
 *
 * Re-exported from `@offisim/core/browser` so the Marketplace flow + harness can
 * consume the validator (PB-002/003 — the §25.2 safety gate) and the
 * materialization mapping (PB-004) through the public entry. Both are pure,
 * deterministic logic over the neutral {@link MissionPlaybook} type (shared-types);
 * nothing here touches fs/shell/git or installs anything (that's the M-pass).
 */

export {
  validatePlaybook,
  capabilityIsAvailable,
  KNOWN_CAPABILITY_KEYS,
  FORBIDDEN_KEYS,
} from './validate.js';
export type {
  PlaybookValidationCode,
  PlaybookValidationError,
  PlaybookValidationResult,
  ValidatedPlaybook,
  ValidatePlaybookOptions,
} from './validate.js';
export { materializePlaybook, UnsupportedRuntimeError } from './materialize.js';
export type {
  MaterializedCriterion,
  MaterializedPlaybook,
  MaterializedSkillBinding,
  PlaybookRuntimeId,
} from './materialize.js';
