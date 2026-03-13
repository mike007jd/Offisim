import type { EventBus } from '@aics/core';
import type { InstallService } from '@aics/install-core';

export interface AicsDebugBridge {
  eventBus: EventBus;
  installService: InstallService | null;
  getSceneState: () => {
    employeeCount: number;
    employeeIds: string[];
    employeeDebugInfo?: Array<{ id: string; x: number; y: number; roleSlug: string | undefined }>;
  };
}

declare global {
  interface Window {
    __AICS_DEBUG__?: AicsDebugBridge;
  }
}
