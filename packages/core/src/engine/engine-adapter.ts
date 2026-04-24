import type { EngineId } from '@offisim/shared-types';
import type { EngineRunContext, EngineRunHandle, EngineTaskEnvelope } from './engine-types.js';

export interface EngineAdapter {
  readonly engineId: EngineId;
  startRun(envelope: EngineTaskEnvelope, context: EngineRunContext): Promise<EngineRunHandle>;
  cancelRun(runId: string): Promise<void>;
}

export interface EngineAdapterRegistry {
  get(engineId: EngineId): EngineAdapter | null | undefined;
}
