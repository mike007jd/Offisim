import type { InMemoryEventBus } from '@offisim/core/browser';
import { NotificationBridge } from '@offisim/core/services';
import { type MutableRefObject, useEffect } from 'react';

export function useNotificationBridge({
  eventBus,
  companyId,
  bridgeRef,
}: {
  eventBus: InMemoryEventBus;
  companyId: string;
  bridgeRef: MutableRefObject<NotificationBridge | null>;
}): void {
  useEffect(() => {
    const bridge = new NotificationBridge(eventBus, companyId);
    bridge.activate();
    bridgeRef.current = bridge;
    return () => {
      bridge.deactivate();
      bridgeRef.current = null;
    };
  }, [eventBus, companyId, bridgeRef]);
}
