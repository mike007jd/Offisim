import type { SceneBeat } from './beat-composer.js';
import type { CharacterPerformanceState } from './performance.js';
import type { ActorStaging } from './staging.js';

export interface EmployeeStaging {
  readonly employeeId: string;
  readonly beat: SceneBeat;
  readonly performance: CharacterPerformanceState;
  readonly staging: ActorStaging | null;
}
