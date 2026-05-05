import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
import type { InstallService } from '@offisim/install-core';
import type { InteractionRequest, Zone } from '@offisim/shared-types';
import type { SendMessageResult } from '../runtime/offisim-runtime-context';
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

interface OffisimDebugZoneInfo
  extends Pick<Zone, 'zoneId' | 'archetype' | 'cx' | 'cz' | 'w' | 'd'> {}

interface OffisimDebugRouteInfo {
  employeeId: string;
  kind: string;
  points: [number, number, number][];
}

export interface OffisimDebugBridge {
  eventBus: EventBus;
  sceneIntentBus?: SceneIntentBus;
  installService: InstallService | null;
  /** Live RuntimeRepositories — exposed in DEV for console-driven live verify. */
  repos?: RuntimeRepositories | null;
  /** Active company id — paired with `repos` for scoping. */
  companyId?: string;
  /** Current pending interaction, if any. */
  pendingInteraction?: InteractionRequest | null;
  /** Resolve the current pending interaction by option id. */
  respondToInteraction?: (
    selectedOptionId: string,
    freeformResponse?: string,
  ) => Promise<SendMessageResult | undefined>;
  /** Devtools helper for directly triggering install tools against the live runtime. */
  runSkillInstallTool?: (toolName: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** Devtools helper for fault-injection live verification of runtime send options. */
  sendMessage?: (
    text: string,
    options?: {
      targetEmployeeId?: string;
      threadId?: string;
      entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
      conversationKey?: string;
    },
  ) => Promise<SendMessageResult | undefined>;
  /** Devtools helper for abort-path live verification. */
  abortExecution?: () => void;
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
