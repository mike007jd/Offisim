import type { RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, cn, useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
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
// Types — mirrored from apps/desktop/renderer workspace types to avoid cross-package deps
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
  const { eventBus } = useOffisimRuntimeServices();
  const { toasts, addToast, dismissToast } = useToasts();
  const { tier } = useLayoutTier();
  const agents = useAgentStates();
  const getEmployeeName = useCallback(
    (employeeId: string) => agents.get(employeeId)?.name ?? null,
    [agents],
  );

  // 7.1 — Subscribe to event store
  const store = useMemo(() => hydrateEventLogStore(eventBus, []), [eventBus]);
  const [events, setEvents] = useState<RuntimeEvent[]>(() => store.events);

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

  if (events.length === 0) {
    return (
      <div className="flex h-full flex-col bg-bg text-ink-1" data-layout-tier={tier}>
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />
        <ActivityEmptyState variant="no-events" onBackToOffice={onBackToOffice} />
      </div>
    );
  }

  // 7.2 — Layout: filter bar + content area
  return (
    <div className="flex h-full flex-col bg-bg text-ink-1" data-layout-tier={tier}>
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
      <div
        className={cn(
          'grid min-h-0 flex-1',
          sessionState.selectedEventId && focusedEvent
            ? 'grid-cols-1 md:grid-activity-detail'
            : 'grid-cols-1',
        )}
      >
        {/* 7.5 — Empty state: filters yield no results */}
        {filteredEvents.length === 0 ? (
          <ActivityEmptyState
            variant="no-results"
            onResetFilters={handleResetFilters}
            onBackToOffice={onBackToOffice}
          />
        ) : (
          <>
            <ActivityTimeline
              groups={groups}
              selectedEventId={sessionState.selectedEventId}
              onSelectEvent={handleSelectEvent}
              className={cn(
                'min-w-0',
                sessionState.selectedEventId && tier === 'narrow' && 'hidden',
              )}
              getEmployeeName={getEmployeeName}
            />
            {sessionState.selectedEventId && focusedEvent && (
              <div className="min-w-0 border-l border-line">
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
