import type { EngineId } from '@offisim/shared-types';
import type {
  EngineRunContext,
  EngineRunHandle,
  EngineTaskEnvelope,
  RuntimeEngineCapabilityProfile,
} from './engine-types.js';

export interface EngineAdapter {
  readonly engineId: EngineId;
  readonly capabilityProfile?: RuntimeEngineCapabilityProfile;
  startRun(envelope: EngineTaskEnvelope, context: EngineRunContext): Promise<EngineRunHandle>;
  cancelRun(runId: string): Promise<void>;
}

export interface EngineAdapterRegistry {
  get(engineId: EngineId): EngineAdapter | null | undefined;
}
