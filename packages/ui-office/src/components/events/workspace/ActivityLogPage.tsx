import type { RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import { Radio, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';
import { ALL_EVENT_TYPES, ALL_LEVELS } from '../EventFilters';
import type { EventFilterType, EventLevel } from '../EventFilters';
import { EventItem, getDisplayLabel } from '../EventItem';
import { TYPE_PREFIX_MAP, getEventLevel, hydrateEventLogStore } from '../EventLog';
import type { EventDisplayLevel } from '../EventLog';
import { ActivityLogEventFocus } from './ActivityLogEventFocus';
import {
  type DatePreset,
  getAvailableActorFilters,
  getDateCutoff,
  getEventId,
  matchesActorFilters,
} from './activity-log-utils';

// ---------------------------------------------------------------------------
// Types -- mirrored from apps/web workspace types to avoid cross-package deps
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
  onSessionStateChange: (
    updater: (prev: ActivityLogSessionState) => ActivityLogSessionState,
  ) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
] as const satisfies readonly { value: DatePreset; label: string }[];

const ACTIVE_LEVEL_COLORS: Record<EventLevel, string> = {
  Info: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  Warning: 'bg-amber-400/20 text-amber-400 border-amber-400/40',
  Error: 'bg-red-500/20 text-red-400 border-red-500/40',
};

// ---------------------------------------------------------------------------
// Time grouping
// ---------------------------------------------------------------------------

type TimeGroup = 'just-now' | 'minutes-ago' | 'earlier-today' | 'yesterday' | 'older';

function getTimeGroup(timestamp: number, now: number): TimeGroup {
  const diff = now - timestamp;
  if (diff < 60_000) return 'just-now';
  if (diff < 600_000) return 'minutes-ago';
  if (diff < 86_400_000) return 'earlier-today';
  if (diff < 172_800_000) return 'yesterday';
  return 'older';
}

const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  'just-now': 'Just now',
  'minutes-ago': 'Minutes ago',
  'earlier-today': 'Earlier today',
  yesterday: 'Yesterday',
  older: 'Older',
};

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

      // Search filter -- match against event type, display label, and entity type
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
      onSessionStateChange((prev) => {
        if (!prev.selectedEventId) return prev;
        return { ...prev, selectedEventId: null };
      });
    }
  }, [sessionState.selectedEventId, focusedEvent, onSessionStateChange, addToast]);

  // Handlers
  const handleSelectEvent = useCallback(
    (event: RuntimeEvent) => {
      onSessionStateChange((prev) => ({
        ...prev,
        selectedEventId: getEventId(event),
      }));
    },
    [onSessionStateChange],
  );

  const handleBackFromFocus = useCallback(() => {
    onSessionStateChange((prev) => ({ ...prev, selectedEventId: null }));
  }, [onSessionStateChange]);

  const handleSearchChange = useCallback(
    (search: string) => {
      onSessionStateChange((prev) => ({ ...prev, search }));
    },
    [onSessionStateChange],
  );

  const handleDatePresetChange = useCallback(
    (datePreset: DatePreset) => {
      onSessionStateChange((prev) => ({ ...prev, datePreset }));
    },
    [onSessionStateChange],
  );

  const handleActorFiltersChange = useCallback(
    (actorFilters: string[]) => {
      onSessionStateChange((prev) => ({ ...prev, actorFilters }));
    },
    [onSessionStateChange],
  );

  // Inline filter toggle logic (previously in ActivityLogFiltersPane)
  function toggleEventType(type: string) {
    if (type === 'All') {
      onSessionStateChange((prev) => ({ ...prev, eventTypes: [] }));
      return;
    }
    const next = sessionState.eventTypes.includes(type)
      ? sessionState.eventTypes.filter((t) => t !== type)
      : [...sessionState.eventTypes, type];
    onSessionStateChange((prev) => ({ ...prev, eventTypes: next }));
  }

  function isTypeActive(type: EventFilterType): boolean {
    if (type === 'All') return sessionState.eventTypes.length === 0;
    return sessionState.eventTypes.includes(type);
  }

  function toggleActor(actor: string) {
    const next = sessionState.actorFilters.includes(actor)
      ? sessionState.actorFilters.filter((a) => a !== actor)
      : [...sessionState.actorFilters, actor];
    handleActorFiltersChange(next);
  }

  // Event-focused mode
  if (sessionState.selectedEventId && focusedEvent) {
    return (
      <div
        className="flex h-full flex-col"
        data-testid="workspace-activity-log"
        data-workspace="activity-log"
      >
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />
        <div className="flex-1 min-h-0 overflow-hidden">
          <ActivityLogEventFocus event={focusedEvent} onBack={handleBackFromFocus} />
        </div>
      </div>
    );
  }

  // Build time-grouped event list
  const now = Date.now();
  let lastGroup: TimeGroup | null = null;

  // Timeline mode
  return (
    <div
      className="flex h-full flex-col"
      data-testid="workspace-activity-log"
      data-workspace="activity-log"
    >
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      {/* Top toolbar -- inline filters */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-2.5 shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={sessionState.search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search..."
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1 text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/30 w-40"
          />
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-white/[0.08]" />

        {/* Date presets */}
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => handleDatePresetChange(p.value)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              sessionState.datePreset === p.value
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30'
                : 'text-slate-500 border border-white/[0.06] hover:text-slate-300'
            }`}
          >
            {p.label}
          </button>
        ))}

        <div className="w-px h-5 bg-white/[0.08]" />

        {/* Event type chips */}
        {ALL_EVENT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => toggleEventType(type)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              isTypeActive(type)
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30'
                : 'text-slate-500 border border-white/[0.06] hover:text-slate-300'
            }`}
          >
            {type}
          </button>
        ))}

        <div className="w-px h-5 bg-white/[0.08]" />

        {/* Level pills (display-only) */}
        {ALL_LEVELS.map((level) => {
          const active =
            sessionState.eventTypes.length === 0 || sessionState.eventTypes.includes(level);
          return (
            <span
              key={level}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                active
                  ? ACTIVE_LEVEL_COLORS[level]
                  : 'text-slate-600 border-white/[0.04] opacity-40'
              }`}
            >
              {level}
            </span>
          );
        })}

        <div className="w-px h-5 bg-white/[0.08]" />

        {/* Actor filters */}
        {actorOptions.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => handleActorFiltersChange([])}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                sessionState.actorFilters.length === 0
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30'
                  : 'text-slate-500 border border-white/[0.06] hover:text-slate-300'
              }`}
            >
              All actors
            </button>
            {actorOptions.map((actor) => (
              <button
                key={actor}
                type="button"
                onClick={() => toggleActor(actor)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors truncate max-w-[120px] ${
                  sessionState.actorFilters.includes(actor)
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30'
                    : 'text-slate-500 border border-white/[0.06] hover:text-slate-300'
                }`}
              >
                {actor}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Event timeline -- full width */}
      <div className="flex-1 min-h-0 overflow-y-auto" data-testid="activity-log-timeline">
        <div ref={scrollRef}>
          {filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-80 gap-4">
              <div className="relative">
                <Radio className="w-10 h-10 text-slate-600 animate-pulse" />
                <span className="absolute inset-0 rounded-full border-2 border-slate-600/30 animate-ping" />
              </div>
              <p className="text-sm text-slate-500 font-medium">
                {events.length === 0 ? 'No activity detected' : 'No events match filters'}
              </p>
              <p className="text-[11px] text-slate-600">
                {events.length === 0
                  ? 'Waiting for simulation events...'
                  : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            filteredEvents.map(({ event, level }, i) => {
              const group = getTimeGroup(event.timestamp, now);
              const showHeader = group !== lastGroup;
              lastGroup = group;

              return (
                <div key={`${event.timestamp}-${i}`}>
                  {/* Time group header */}
                  {showHeader && (
                    <div className="flex items-center gap-3 px-5 py-2 mt-1">
                      <div className="h-px flex-1 bg-white/[0.06]" />
                      <span className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold">
                        {TIME_GROUP_LABELS[group]}
                      </span>
                      <div className="h-px flex-1 bg-white/[0.06]" />
                    </div>
                  )}
                  <button
                    type="button"
                    className={`cursor-pointer hover:bg-white/[0.04] transition-colors text-left w-full border-l-[3px] ${
                      level === 'Error'
                        ? 'border-l-red-400/60'
                        : level === 'Warning'
                          ? 'border-l-amber-400/60'
                          : 'border-l-transparent'
                    }`}
                    onClick={() => handleSelectEvent(event)}
                  >
                    <EventItem event={event} level={level} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default ActivityLogPage;
