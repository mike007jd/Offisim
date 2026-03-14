import type { AicsDebugBridge } from '@aics/ui-office';

declare global {
  interface Window {
    __AICS_DEBUG__?: AicsDebugBridge;
  }
}
