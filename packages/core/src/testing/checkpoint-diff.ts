import { canonicalJson } from './canonical-json.js';
import type { ScenarioTraceReport } from './trace-recorder.js';

export interface CheckpointDiffReport {
  readonly equivalent: boolean;
  readonly uninterruptedHash: string;
  readonly resumedHash: string;
  readonly reason?: string;
}

export async function compareScenarioTraces(
  uninterrupted: ScenarioTraceReport,
  resumed: ScenarioTraceReport,
): Promise<CheckpointDiffReport> {
  const left = canonicalJson(uninterrupted.trace);
  const right = canonicalJson(resumed.trace);
  const equivalent = left === right;
  return {
    equivalent,
    uninterruptedHash: uninterrupted.traceHash,
    resumedHash: resumed.traceHash,
    ...(equivalent ? {} : { reason: 'Normalized traces differ.' }),
  };
}
