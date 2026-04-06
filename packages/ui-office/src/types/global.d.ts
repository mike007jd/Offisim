import type { EventBus } from '@offisim/core/browser';
import type { InstallService } from '@offisim/install-core';
import type { Zone } from '@offisim/shared-types';
import type { SceneIntentBus } from '../runtime/scene-intents';

interface OffisimDebugEmployeeInfo {
  id: string;
  x: number;
  y: number;
  roleSlug: string | undefined;
  isMoving?: boolean;
}

interface OffisimDebugFootprint {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
}

interface OffisimDebugZoneInfo extends Pick<Zone, 'zoneId' | 'archetype' | 'cx' | 'cz' | 'w' | 'd'> {}

interface OffisimDebugRouteInfo {
  employeeId: string;
  kind: string;
  points: [number, number, number][];
}

export interface OffisimDebugBridge {
  eventBus: EventBus;
  sceneIntentBus?: SceneIntentBus;
  installService: InstallService | null;
  sceneActions?: {
    moveEmployeeToMeeting?: (employeeId: string) => boolean;
    dispatchEmployeeToWorkspace?: (employeeId: string) => boolean;
    returnEmployeeToMeeting?: (employeeId: string) => boolean;
  };
  getSceneState: () => {
    employeeCount: number;
    employeeIds: string[];
    employeeDebugInfo?: OffisimDebugEmployeeInfo[];
    obstacleFootprints?: OffisimDebugFootprint[];
    zones?: OffisimDebugZoneInfo[];
    lastRoute?: OffisimDebugRouteInfo | null;
  };
}

declare global {
  interface Window {
    __OFFISIM_DEBUG__?: OffisimDebugBridge;
  }
}
