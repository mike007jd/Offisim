import type { RuntimeEvent } from '@offisim/shared-types';
import { ScrollArea, ToastBanner, useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';
import type { EventFilterType } from '../EventFilters';
import { EventItem, getDisplayLabel } from '../EventItem';
import {
  LEVEL_ROW_STYLES,
  TYPE_PREFIX_MAP,
  getEventLevel,
  hydrateEventLogStore,
} from '../EventLog';
import type { EventDisplayLevel } from '../EventLog';
import { ActivityLogEventFocus } from './ActivityLogEventFocus';
import { ActivityLogFiltersPane } from './ActivityLogFiltersPane';
import type { DatePreset } from './ActivityLogFiltersPane';
import { WorkspacePageShell } from '../../workspace/WorkspacePageShell.js';
import {
  getAvailableActorFilters,
  matchesActorFilters,
} from './activity-log-utils';

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ActivityLogPageProps {
  sessionState: ActivityLogSessionState;
  onSessionStateChange: (state: ActivityLogSessionState) => void;
}

// ---------------------------------------------------------------------------
// Date preset → cutoff timestamp
// ---------------------------------------------------------------------------

function getEventId(event: RuntimeEvent): string {
  return `${event.timestamp}-${event.entityId ?? 'none'}`;
}

function getDateCutoff(preset: DatePreset): number {
  const now = Date.now();
  switch (preset) {
    case 'today':
      return now - 24 * 60 * 60 * 1000;
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000;
    case 'custom':
      return 0; // no cutoff
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityLogPage({ sessionState, onSessionStateChange }: ActivityLogPageProps) {
  const { eventBus, bootstrapState } = useOffisimRuntime();
  const { toasts, addToast, dismissToast } = useToasts();
  const store = useMemo(
    () => hydrateEventLogStore(eventBus, bootstrapState?.eventHistory ?? []),
    [eventBus, bootstrapState],
  );
  const [events, setEvents] = useState<RuntimeEvent[]>(() => store.events);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync events from the shared store
  useEffect(() => {
    setEvents(store.events);
    const syncEvents = () => setEvents(store.events);
    store.listeners.add(syncEvents);
    return () => {
      store.listeners.delete(syncEvents);
    };
  }, [store]);

  // Auto-scroll to bottom on new events (only when not focused on an event)
  // biome-ignore lint/correctness/useExhaustiveDependencies: events array triggers scroll intentionally
  useEffect(() => {
    if (!sessionState.selectedEventId && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, sessionState.selectedEventId]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    const { search, eventTypes, datePreset } = sessionState;
    const searchLower = search.toLowerCase();
    const cutoff = getDateCutoff(datePreset);

    // Collect all matching prefixes from selected event types
    const prefixes: string[] = [];
    if (eventTypes.length > 0) {
      for (const type of eventTypes) {
        const p = TYPE_PREFIX_MAP[type as EventFilterType];
        if (p) prefixes.push(...p);
      }
    }

    const result: { event: RuntimeEvent; level: EventDisplayLevel }[] = [];
    for (const event of events) {
      // Date filter
      if (event.timestamp < cutoff) continue;

      // Type filter
      if (prefixes.length > 0 && !prefixes.some((p) => event.type.startsWith(p))) continue;

      // Actor filter
      if (!matchesActorFilters(event, sessionState.actorFilters)) continue;

      // Search filter — match against event type, display label, and entity type
      if (searchLower) {
        const haystack =
          `${event.type} ${getDisplayLabel(event)} ${event.entityType ?? ''}`.toLowerCase();
        if (!haystack.includes(searchLower)) continue;
      }

      result.push({ event, level: getEventLevel(event) });
    }
    return result;
  }, [events, sessionState]);

  const actorOptions = useMemo(() => getAvailableActorFilters(events), [events]);

  // Find the focused event
  const focusedEvent = useMemo(() => {
    if (!sessionState.selectedEventId) return null;
    return events.find((e) => getEventId(e) === sessionState.selectedEventId) ?? null;
  }, [events, sessionState.selectedEventId]);

  // Deleted entity recovery: selected event no longer in store
  useEffect(() => {
    if (sessionState.selectedEventId && !focusedEvent) {
      addToast('The selected event is no longer available.', 'info');
      onSessionStateChange({ ...sessionState, selectedEventId: null });
    }
  }, [sessionState, focusedEvent, onSessionStateChange, addToast]);

  // Handlers
  const handleSelectEvent = useCallback(
    (event: RuntimeEvent) => {
      onSessionStateChange({
        ...sessionState,
        selectedEventId: getEventId(event),
      });
    },
    [sessionState, onSessionStateChange],
  );

  const handleBackFromFocus = useCallback(() => {
    onSessionStateChange({
      ...sessionState,
      selectedEventId: null,
    });
  }, [sessionState, onSessionStateChange]);

  const handleSearchChange = useCallback(
    (search: string) => {
      onSessionStateChange({ ...sessionState, search });
    },
    [sessionState, onSessionStateChange],
  );

  const handleEventTypesChange = useCallback(
    (eventTypes: string[]) => {
      onSessionStateChange({ ...sessionState, eventTypes });
    },
    [sessionState, onSessionStateChange],
  );

  const handleDatePresetChange = useCallback(
    (datePreset: DatePreset) => {
      onSessionStateChange({ ...sessionState, datePreset });
    },
    [sessionState, onSessionStateChange],
  );

  const handleActorFiltersChange = useCallback(
    (actorFilters: string[]) => {
      onSessionStateChange({ ...sessionState, actorFilters });
    },
    [sessionState, onSessionStateChange],
  );

  // Event-focused mode
  if (sessionState.selectedEventId && focusedEvent) {
    return (
      <WorkspacePageShell
        title="Activity Log"
        workspace="activity-log"
        testId="workspace-activity-log"
        topSlot={<ToastBanner toasts={toasts} onDismiss={dismissToast} />}
      >
        <div className="flex-1 min-h-0 overflow-hidden">
          <ActivityLogEventFocus event={focusedEvent} onBack={handleBackFromFocus} />
        </div>
      </WorkspacePageShell>
    );
  }

  return (
    <WorkspacePageShell
      title="Activity Log"
      workspace="activity-log"
      testId="workspace-activity-log"
      topSlot={<ToastBanner toasts={toasts} onDismiss={dismissToast} />}
    >
      <div className="activity-log-panes">
        <aside
          className="activity-log-filters"
          data-testid="activity-log-filters"
          aria-label="Activity log filters"
        >
          <ActivityLogFiltersPane
            search={sessionState.search}
            eventTypes={sessionState.eventTypes}
            actorOptions={actorOptions}
            actorFilters={sessionState.actorFilters}
            datePreset={sessionState.datePreset}
            onSearchChange={handleSearchChange}
            onEventTypesChange={handleEventTypesChange}
            onActorFiltersChange={handleActorFiltersChange}
            onDatePresetChange={handleDatePresetChange}
          />
        </aside>

        <main
          className="activity-log-timeline"
          data-testid="activity-log-timeline"
          aria-label="Event timeline"
        >
          <ScrollArea className="h-full">
            <div ref={scrollRef}>
              {filteredEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-2 text-center px-6">
                  {events.length === 0 ? (
                    <>
                      <p className="text-sm text-slate-400">No events yet</p>
                      <p className="text-xs text-slate-500">
                        Events will appear here as your company operates.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-slate-400">No events match filters</p>
                      <p className="text-xs text-slate-500">
                        Try adjusting your filters or search query.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                filteredEvents.map(({ event, level }, i) => {
                  const rowStyle = LEVEL_ROW_STYLES[level];
                  return (
                    <button
                      type="button"
                      key={`${event.timestamp}-${i}`}
                      className={`${rowStyle} cursor-pointer hover:bg-white/5 transition-colors text-left w-full`}
                      onClick={() => handleSelectEvent(event)}
                    >
                      <EventItem event={event} />
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </main>
      </div>
    </WorkspacePageShell>
  );
}

export default ActivityLogPage;
