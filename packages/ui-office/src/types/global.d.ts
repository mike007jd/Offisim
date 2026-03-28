import type { EventBus } from '@offisim/core/browser';
import type { InstallService } from '@offisim/install-core';

export interface OffisimDebugBridge {
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
    __OFFISIM_DEBUG__?: OffisimDebugBridge;
  }
}
