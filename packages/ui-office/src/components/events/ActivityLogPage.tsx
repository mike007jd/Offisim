import type { RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, WorkspacePageSkeleton, cn, useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { ActivityEmptyState } from './ActivityEmptyState';
import { ActivityEventDetail } from './ActivityEventDetail';
import { ActivityFilterBar } from './ActivityFilterBar';
import { ActivityTimeline } from './ActivityTimeline';
import { hydrateEventLogStore } from './EventLog';
import { filterEvents } from './activity-log-filter';
import { groupEventsByTime } from './activity-log-grouping';
import {
  type DatePreset,
  getAvailableActorFilters,
  getEventId,
} from './workspace/activity-log-utils';

// ---------------------------------------------------------------------------
// Types — mirrored from apps/web workspace types to avoid cross-package deps
// ---------------------------------------------------------------------------

export type ActivityLogSessionState = {
  selectedEventId: string | null;
  search: string;
  eventTypes: string[];
  actorFilters: string[];
  datePreset: 'today' | '7d' | '30d' | 'custom';
};

export interface ActivityLogPageProps {
  sessionState: ActivityLogSessionState;
  onSessionStateChange: (
    updater: (prev: ActivityLogSessionState) => ActivityLogSessionState,
  ) => void;
  onBackToOffice?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityLogPage({
  sessionState,
  onSessionStateChange,
  onBackToOffice,
}: ActivityLogPageProps) {
  const { eventBus, bootstrapState } = useOffisimRuntime();
  const { toasts, addToast, dismissToast } = useToasts();
  const { tier } = useLayoutTier();
  const agents = useAgentStates();
  const getEmployeeName = useCallback(
    (employeeId: string) => agents.get(employeeId)?.name ?? null,
    [agents],
  );

  // 7.1 — Subscribe to event store
  const store = useMemo(
    () => hydrateEventLogStore(eventBus, bootstrapState?.eventHistory ?? []),
    [eventBus, bootstrapState],
  );
  const [events, setEvents] = useState<RuntimeEvent[]>(() => store.events);
  const isHydrating = !bootstrapState && events.length === 0;

  useEffect(() => {
    setEvents(store.events);
    const syncEvents = () => setEvents(store.events);
    store.listeners.add(syncEvents);
    return () => {
      store.listeners.delete(syncEvents);
    };
  }, [store]);

  // 7.1 — Filter + group pipeline
  const filteredEvents = useMemo(
    () =>
      filterEvents(events, {
        datePreset: sessionState.datePreset,
        eventTypes: sessionState.eventTypes,
        actorFilters: sessionState.actorFilters,
        search: sessionState.search,
      }),
    [
      events,
      sessionState.datePreset,
      sessionState.eventTypes,
      sessionState.actorFilters,
      sessionState.search,
    ],
  );

  const groups = useMemo(() => groupEventsByTime(filteredEvents), [filteredEvents]);

  const actorOptions = useMemo(() => getAvailableActorFilters(events), [events]);

  // 7.3 — Find focused event
  const focusedEvent = useMemo(() => {
    if (!sessionState.selectedEventId) return null;
    return events.find((e) => getEventId(e) === sessionState.selectedEventId) ?? null;
  }, [events, sessionState.selectedEventId]);

  // 7.3 — Selected event no longer in store → toast + reset
  useEffect(() => {
    if (sessionState.selectedEventId && !focusedEvent) {
      addToast('The selected event is no longer available.', 'info');
      onSessionStateChange((prev) => {
        if (!prev.selectedEventId) return prev;
        return { ...prev, selectedEventId: null };
      });
    }
  }, [sessionState.selectedEventId, focusedEvent, onSessionStateChange, addToast]);

  // 7.3 — Event selection handler
  const handleSelectEvent = useCallback(
    (eventId: string) => {
      onSessionStateChange((prev) => ({
        ...prev,
        selectedEventId: prev.selectedEventId === eventId ? null : eventId,
      }));
    },
    [onSessionStateChange],
  );

  // 7.3 — Close detail panel
  const handleCloseDetail = useCallback(() => {
    onSessionStateChange((prev) => ({ ...prev, selectedEventId: null }));
  }, [onSessionStateChange]);

  // 7.4 — Reset filters
  const handleResetFilters = useCallback(() => {
    onSessionStateChange((prev) => ({
      ...prev,
      search: '',
      eventTypes: [],
      actorFilters: [],
      datePreset: '30d' as const,
    }));
  }, [onSessionStateChange]);

  // Filter change handlers
  const handleDatePresetChange = useCallback(
    (datePreset: DatePreset) => {
      onSessionStateChange((prev) => ({ ...prev, datePreset }));
    },
    [onSessionStateChange],
  );

  const handleEventTypesChange = useCallback(
    (eventTypes: string[]) => {
      onSessionStateChange((prev) => ({ ...prev, eventTypes }));
    },
    [onSessionStateChange],
  );

  const handleActorFiltersChange = useCallback(
    (actorFilters: string[]) => {
      onSessionStateChange((prev) => ({ ...prev, actorFilters }));
    },
    [onSessionStateChange],
  );

  const handleSearchChange = useCallback(
    (search: string) => {
      onSessionStateChange((prev) => ({ ...prev, search }));
    },
    [onSessionStateChange],
  );

  // 7.5 — Empty state: no events at all
  if (isHydrating) {
    return (
      <div className="flex h-full flex-col" data-layout-tier={tier}>
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />
        <WorkspacePageSkeleton />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex h-full flex-col" data-layout-tier={tier}>
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />
        <ActivityEmptyState variant="no-events" onBackToOffice={onBackToOffice} />
      </div>
    );
  }

  // 7.2 — Layout: filter bar + content area
  return (
    <div className="flex h-full flex-col" data-layout-tier={tier}>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
      <ActivityFilterBar
        datePreset={sessionState.datePreset}
        eventTypes={sessionState.eventTypes}
        actorFilters={sessionState.actorFilters}
        actorOptions={actorOptions}
        search={sessionState.search}
        onDatePresetChange={handleDatePresetChange}
        onEventTypesChange={handleEventTypesChange}
        onActorFiltersChange={handleActorFiltersChange}
        onSearchChange={handleSearchChange}
        variant={tier === 'narrow' ? 'narrow' : 'default'}
      />
      <div className="flex min-h-0 flex-1">
        {/* 7.5 — Empty state: filters yield no results */}
        {filteredEvents.length === 0 ? (
          <ActivityEmptyState
            variant="no-results"
            onResetFilters={handleResetFilters}
            onBackToOffice={onBackToOffice}
          />
        ) : (
          <>
            {/* 7.2 — Timeline: full-width or 60% when detail open */}
            <ActivityTimeline
              groups={groups}
              selectedEventId={sessionState.selectedEventId}
              onSelectEvent={handleSelectEvent}
              className={
                sessionState.selectedEventId
                  ? cn(tier === 'desktop' ? 'w-3/5' : tier === 'tablet' ? 'w-[70%]' : 'hidden')
                  : 'w-full'
              }
              getEmployeeName={getEmployeeName}
            />
            {/* 7.2 — Detail panel: 40% when event selected */}
            {sessionState.selectedEventId && focusedEvent && (
              <div
                className={cn(
                  'border-l border-white/10',
                  tier === 'desktop' ? 'w-2/5' : tier === 'tablet' ? 'w-[30%]' : 'w-full',
                )}
              >
                <ActivityEventDetail event={focusedEvent} onClose={handleCloseDetail} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ActivityLogPage;
