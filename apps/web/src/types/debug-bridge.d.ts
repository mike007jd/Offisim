import type { InMemoryEventBus } from '@aics/core';
import type { InstallService } from '@aics/install-core';

/**
 * Debug bridge exposed on window in dev mode only.
 * Used by E2E smoke tests to inspect runtime internals.
 * Production builds eliminate this via import.meta.env.DEV guard.
 */
export interface AicsDebugBridge {
  eventBus: InMemoryEventBus;
  installService: InstallService | null;
  getSceneState: () => {
    employeeCount: number;
    employeeIds: string[];
  };
}

declare global {
  interface Window {
    __AICS_DEBUG__?: AicsDebugBridge;
  }
}
