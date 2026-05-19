import type {
  DeliverableCreatedPayload,
  GraphNodeEnteredPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useRef } from 'react';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context.js';

const GUIDANCE_ITEMS = [
  {
    key: 'guidance_sop',
    event: 'plan.completed',
    message: 'Repeating this task? Create a SOP to automate it next time.',
  },
  {
    key: 'guidance_memory',
    event: 'memory.created',
    message: 'Your employee learned something new — check Memories in their profile.',
  },
] as const;

const PROJECT_GUIDANCE = {
  key: 'guidance_project',
  message: 'Organize related work into a Project for better tracking.',
} as const;

const MARKET_GUIDANCE = {
  key: 'guidance_market',
  message: 'Browse the Market to hire specialized employees for your team.',
} as const;

const RATE_LIMIT_MS = 5 * 60 * 1000;
const MARKET_DELAY_MS = 10_000;
const TOAST_DURATION_MS = 5_000;

type GuidanceToast = {
  key: string;
  message: string;
};

function isDismissed(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(`guidance_dismissed_${key}`) === '1';
}

function markDismissed(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`guidance_dismissed_${key}`, '1');
}

export function useFirstRunGuidance() {
  const { eventBus } = useOffisimRuntimeServices();
  const { toasts, addToast, dismissToast } = useToasts();
  const bossEntryCountRef = useRef(0);
  const lastShownAtRef = useRef(0);
  const pendingQueueRef = useRef<GuidanceToast[]>([]);
  const pendingTimerRef = useRef<number | null>(null);
  const marketTimerRef = useRef<number | null>(null);

  const clearPendingTimer = useCallback(() => {
    if (pendingTimerRef.current === null || typeof window === 'undefined') {
      return;
    }
    window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
  }, []);

  const clearMarketTimer = useCallback(() => {
    if (marketTimerRef.current === null || typeof window === 'undefined') {
      return;
    }
    window.clearTimeout(marketTimerRef.current);
    marketTimerRef.current = null;
  }, []);

  const showToast = useCallback(
    (item: GuidanceToast) => {
      if (isDismissed(item.key)) {
        return;
      }
      addToast(item.message, 'info', {
        durationMs: TOAST_DURATION_MS,
      });
      lastShownAtRef.current = Date.now();
      markDismissed(item.key);
    },
    [addToast],
  );

  const flushQueue = useCallback(() => {
    clearPendingTimer();
    while (pendingQueueRef.current.length > 0) {
      const nextItem = pendingQueueRef.current.shift();
      if (!nextItem || isDismissed(nextItem.key)) {
        continue;
      }
      showToast(nextItem);
      break;
    }
  }, [clearPendingTimer, showToast]);

  const scheduleFlush = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (pendingTimerRef.current !== null) return;
    if (pendingQueueRef.current.length === 0) return;

    const delay = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastShownAtRef.current));
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null;
      flushQueue();
      if (pendingQueueRef.current.length > 0) {
        scheduleFlush();
      }
    }, delay);
  }, [flushQueue]);

  const enqueueGuidance = useCallback(
    (item: GuidanceToast) => {
      if (isDismissed(item.key)) {
        return;
      }

      const now = Date.now();
      const canShowNow =
        lastShownAtRef.current === 0 || now - lastShownAtRef.current >= RATE_LIMIT_MS;

      if (canShowNow && pendingQueueRef.current.length === 0) {
        showToast(item);
        return;
      }

      const alreadyQueued = pendingQueueRef.current.some((queued) => queued.key === item.key);
      if (alreadyQueued) {
        return;
      }

      pendingQueueRef.current.push(item);
      scheduleFlush();
    },
    [scheduleFlush, showToast],
  );

  useEffect(() => {
    const unsubscribers = GUIDANCE_ITEMS.map((item) =>
      eventBus.on(item.event, () => {
        enqueueGuidance(item);
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [enqueueGuidance, eventBus]);

  useEffect(() => {
    return eventBus.on('graph.node.entered', (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
      if (event.payload.nodeName !== 'boss') {
        return;
      }
      bossEntryCountRef.current += 1;
      if (bossEntryCountRef.current === 3) {
        enqueueGuidance(PROJECT_GUIDANCE);
      }
    });
  }, [enqueueGuidance, eventBus]);

  useEffect(() => {
    return eventBus.on('deliverable.created', (_event: RuntimeEvent<DeliverableCreatedPayload>) => {
      if (isDismissed(MARKET_GUIDANCE.key) || typeof window === 'undefined') {
        return;
      }
      clearMarketTimer();
      marketTimerRef.current = window.setTimeout(() => {
        marketTimerRef.current = null;
        enqueueGuidance(MARKET_GUIDANCE);
      }, MARKET_DELAY_MS);
    });
  }, [clearMarketTimer, enqueueGuidance, eventBus]);

  useEffect(() => {
    return () => {
      clearPendingTimer();
      clearMarketTimer();
    };
  }, [clearMarketTimer, clearPendingTimer]);

  return {
    toasts,
    dismissToast,
  };
}
