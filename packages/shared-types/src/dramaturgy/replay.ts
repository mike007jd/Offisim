/**
 * Deterministic dramaturgy replay (Phase 6, source plan §14).
 *
 * Replay is a pure function of the STORED source-event log + the dramaturgy
 * version — never a generated action script. The same source data and version
 * always produce the same beats and office staging, so a past run can be
 * re-staged exactly (and the live scene and a replay agree). The version is a
 * seed input baked into every variant hash, so bumping it is what intentionally
 * changes presentation.
 */
import {
  type DramaturgyConfig,
  type SceneBeat,
  type TimedAgentRunEvent,
  composeBeats,
} from './beat-composer.js';
import { type DramaturgyModeOptions, applyDramaturgyMode } from './modes.js';
import { type EmployeeStaging, projectOfficeStaging } from './office-projection.js';
import type { StagingPrefab } from './staging.js';

/** Current dramaturgy version — the seed input stored alongside a run's events. */
export const DRAMATURGY_VERSION = 'v1';

/** The persisted, replayable source of truth for a run's dramaturgy. */
export interface DramaturgyReplaySource {
  readonly dramaturgyVersion: string;
  readonly events: readonly TimedAgentRunEvent[];
}

export interface DramaturgyReplayResult {
  readonly beats: readonly SceneBeat[];
  readonly staging: readonly EmployeeStaging[];
}

/** Bundle the current run's source events with the active version for storage. */
export function captureReplaySource(
  events: readonly TimedAgentRunEvent[],
  dramaturgyVersion: string = DRAMATURGY_VERSION,
): DramaturgyReplaySource {
  return { dramaturgyVersion, events: [...events] };
}

/**
 * Deterministically replay a stored source into beats + office staging, using
 * ONLY the stored events + version + the office prefab layout. Identical inputs
 * always yield identical output.
 */
export function replayDramaturgy(
  source: DramaturgyReplaySource,
  prefabs: readonly StagingPrefab[],
  mode: DramaturgyModeOptions,
  config?: Omit<DramaturgyConfig, 'dramaturgyVersion'>,
): DramaturgyReplayResult {
  const beats = composeBeats(source.events, {
    ...config,
    dramaturgyVersion: source.dramaturgyVersion,
  });
  const staging = applyDramaturgyMode(projectOfficeStaging(beats, prefabs), mode);
  return { beats, staging };
}
