import type { SceneBeat } from './beat-composer.js';
import type { CharacterPerformanceState } from './performance.js';
import type { ActorStaging } from './staging.js';

export interface EmployeeStaging {
  readonly employeeId: string;
  readonly beat: SceneBeat;
  readonly performance: CharacterPerformanceState;
  /** Reserved relocation anchor for a high-value movement beat; null = stay home. */
  readonly staging: ActorStaging | null;
}
