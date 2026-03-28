import type { OffisimDebugBridge } from '@offisim/ui-office';

declare global {
  interface Window {
    __OFFISIM_DEBUG__?: OffisimDebugBridge;
  }
}
