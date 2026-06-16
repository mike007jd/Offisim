import { useUiState } from '@/app/ui-state.js';
import { Select, type SelectOption } from '@/design-system/grammar/Select.js';
import { cn } from '@/lib/utils.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Activity, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ActivityEventDetail } from './ActivityEventDetail.js';
import {
  ALL_EVENT_TYPES,
  type ActivityFilters,
  type ActivityRecord,
  DATE_PRESETS,
  type DatePreset,
  type TimelineRow,
  collapseReroutes,
  domainIcon,
  filterRecords,
  formatRelativeTimestamp,
  getAvailableActorFilters,
  getDisplaySummary,
  getEventLevel,
  groupByTime,
  useActivityRecords,
} from './activity-data.js';

const GROUP_HEADER_HEIGHT = 28;
const ROW_HEIGHT = 36;

/** Flat virtualizer items: a group header or one timeline row. */
type TimelineItem =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; row: TimelineRow };

const DATE_OPTIONS: ReadonlyArray<SelectOption> = DATE_PRESETS.map((p) => ({
  value: p.value,
  label: p.label,
}));

const EVENT_TYPE_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'all', label: 'All events' },
  ...ALL_EVENT_TYPES.map((t) => ({ value: t.value, label: t.label })),
];

export function ActivitySurface() {
  const companyId = useUiState((s) => s.companyId);
  const records = useActivityRecords(companyId);
  const setSurface = useUiState((s) => s.setSurface);

  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [eventType, setEventType] = useState<string>('all');
  const [actor, setActor] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Once the user explicitly picks a date window, stop auto-widening it.
  const hasUserPickedDate = useRef(false);

  const allRecords = useMemo(() => records.data ?? [], [records.data]);

  // "Today" is the right resting default when today has activity — but on first
  // open it must not hide an entire non-empty history behind a false "no events"
  // first impression. If today is empty against a non-empty dataset, widen to
  // the narrowest window that has rows. Respects an explicit user pick.
  useEffect(() => {
    if (records.isLoading || hasUserPickedDate.current) return;
    if (datePreset !== 'today' || allRecords.length === 0) return;
    const dateOnly = (preset: DatePreset) =>
      filterRecords(allRecords, { datePreset: preset, eventType: 'all', actor: 'all', search: '' })
        .length;
    if (dateOnly('today') > 0) return;
    const widened = (['7d', '30d', 'all'] as DatePreset[]).find((preset) => dateOnly(preset) > 0);
    if (widened) setDatePreset(widened);
  }, [records.isLoading, allRecords, datePreset]);

  const filters: ActivityFilters = useMemo(
    () => ({ datePreset, eventType, actor, search }),
    [datePreset, eventType, actor, search],
  );

  // One date-window pass shared by the stats strip and the list pipeline —
  // type/actor/search narrow the list below, not the overview numbers.
  const dateRecords = useMemo(
    () => filterRecords(allRecords, { datePreset, eventType: 'all', actor: 'all', search: '' }),
    [allRecords, datePreset],
  );

  const windowStats = useMemo(() => {
    const actorCounts = new Map<string, number>();
    let issues = 0;
    for (const record of dateRecords) {
      const level = getEventLevel(record.type);
      if (level === 'warning' || level === 'error') issues += 1;
      const actorLabel = getDisplaySummary(record).actor ?? record.actor;
      if (actorLabel) actorCounts.set(actorLabel, (actorCounts.get(actorLabel) ?? 0) + 1);
    }
    const topActor = [...actorCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    return {
      total: dateRecords.length,
      actors: actorCounts.size,
      issues,
      topActor: topActor ? `${topActor[0]} · ${topActor[1]}` : '—',
    };
  }, [dateRecords]);

  const actorOptions = useMemo<ReadonlyArray<SelectOption>>(
    () => [{ value: 'all', label: 'All actors' }, ...getAvailableActorFilters(allRecords)],
    [allRecords],
  );

  // Pipeline: (shared date pass) → type → actor → search → group → collapse.
  const groups = useMemo(() => {
    const filtered = filterRecords(dateRecords, { ...filters, datePreset: 'all' });
    return groupByTime(filtered).map((group) => ({
      ...group,
      rows: collapseReroutes(group.records),
    }));
  }, [dateRecords, filters]);

  const items = useMemo<TimelineItem[]>(() => {
    const flat: TimelineItem[] = [];
    for (const group of groups) {
      flat.push({
        kind: 'header',
        key: `h-${group.key}`,
        label: group.label,
        count: group.records.length,
      });
      for (const row of group.rows) {
        flat.push({ kind: 'row', key: `r-${row.record.id}`, row });
      }
    }
    return flat;
  }, [groups]);

  const selectedRecord = useMemo<ActivityRecord | null>(() => {
    if (!selectedEventId) return null;
    return allRecords.find((r) => r.id === selectedEventId) ?? null;
  }, [selectedEventId, allRecords]);

  // Stale-selection: a selection is set but no longer resolvable (rolled out of
  // the store, or the filtered list no longer contains it) → toast + reset.
  useEffect(() => {
    if (!selectedEventId) return;
    if (records.isLoading) return;
    const stillVisible = items.some(
      (item) => item.kind === 'row' && item.row.record.id === selectedEventId,
    );
    if (!stillVisible) {
      toast.info('Event no longer available.');
      setSelectedEventId(null);
    }
  }, [selectedEventId, items, records.isLoading]);

  const headerIndices = useMemo(() => {
    const indices: number[] = [];
    items.forEach((item, i) => {
      if (item.kind === 'header') indices.push(i);
    });
    return indices;
  }, [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (items[index]?.kind === 'header' ? GROUP_HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 10,
    rangeExtractor: (range) => {
      // Keep the active group header pinned at the top while scrolling.
      const active = [...headerIndices].reverse().find((i) => i <= range.startIndex);
      const visible = new Set<number>();
      if (active !== undefined) visible.add(active);
      for (let i = range.startIndex; i <= range.endIndex; i++) visible.add(i);
      return [...visible].sort((a, b) => a - b);
    },
  });

  const toggleSelect = useCallback((id: string) => {
    setSelectedEventId((current) => (current === id ? null : id));
  }, []);

  const resetFilters = useCallback(() => {
    setSearch('');
    setEventType('all');
    setActor('all');
    setDatePreset('30d');
  }, []);

  const backToOffice = useCallback(() => setSurface('office'), [setSurface]);

  const detailOpen = selectedRecord !== null;
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="off-act">
      <div className="off-act-filter">
        <Select
          options={DATE_OPTIONS}
          value={datePreset}
          aria-label="Date range"
          onChange={(e) => {
            hasUserPickedDate.current = true;
            setDatePreset(e.target.value as DatePreset);
          }}
        />
        <Select
          options={EVENT_TYPE_OPTIONS}
          value={eventType}
          aria-label="Event type"
          onChange={(e) => setEventType(e.target.value)}
        />
        <Select
          options={actorOptions}
          value={actor}
          aria-label="Actor"
          onChange={(e) => setActor(e.target.value)}
        />
        <div className="off-act-search">
          <Search aria-hidden className="off-act-search-ico" />
          <input
            className="off-focusable"
            value={search}
            placeholder="Search events..."
            aria-label="Search events"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {allRecords.length > 0 ? (
        <div className="off-act-stats" aria-label="Activity overview">
          <div className="off-act-stat">
            <span className="off-act-stat-v">{windowStats.total}</span>
            <span className="off-act-stat-l">Events</span>
          </div>
          <div className="off-act-stat">
            <span className="off-act-stat-v">{windowStats.actors}</span>
            <span className="off-act-stat-l">Actors</span>
          </div>
          <div className={cn('off-act-stat', windowStats.issues > 0 && 'is-warn')}>
            <span className="off-act-stat-v">{windowStats.issues}</span>
            <span className="off-act-stat-l">Warnings &amp; errors</span>
          </div>
          <div className="off-act-stat">
            <span className="off-act-stat-v is-text">{windowStats.topActor}</span>
            <span className="off-act-stat-l">Most active</span>
          </div>
        </div>
      ) : null}

      {records.isError && allRecords.length === 0 ? (
        <div className="off-act-empty-wrap">
          <ErrorState
            title="Couldn't load activity"
            detail={errorDetail(records.error, 'The event log failed to load.')}
            onRetry={() => void records.refetch()}
          />
        </div>
      ) : records.isLoading && allRecords.length === 0 ? (
        <div className="off-act-empty-wrap">
          <SkeletonRows rows={8} />
        </div>
      ) : allRecords.length === 0 ? (
        <div className="off-act-empty-wrap">
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Workspace and runtime events show up here once you start a task in Office."
            action={{ label: 'Back to Office', onClick: backToOffice }}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="off-act-empty-wrap">
          <div className="off-act-noresults">
            <EmptyState
              icon={Search}
              title="No events match your filters"
              description="Try a wider time range or fewer filters."
              action={{ label: 'Reset filters', onClick: resetFilters }}
            />
            <button type="button" className="off-act-noresults-secondary" onClick={backToOffice}>
              Back to Office
            </button>
          </div>
        </div>
      ) : (
        <div className={cn('off-act-body', detailOpen && 'is-split')}>
          <div className="off-act-tl" ref={scrollRef}>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((vi) => {
                const item = items[vi.index];
                if (!item) return null;
                const isActiveHeader =
                  item.kind === 'header' && vi.index === virtualItems[0]?.index;
                if (item.kind === 'header') {
                  return (
                    <div
                      key={item.key}
                      className="off-tl-grp-head"
                      data-pinned={isActiveHeader ? '' : undefined}
                      style={{
                        position: isActiveHeader ? 'sticky' : 'absolute',
                        top: 0,
                        zIndex: isActiveHeader ? 2 : 1,
                        transform: isActiveHeader ? undefined : `translateY(${vi.start}px)`,
                        width: '100%',
                      }}
                    >
                      <span className="off-tl-gl">{item.label}</span>
                      <span className="off-tl-cnt">{item.count}</span>
                    </div>
                  );
                }
                const { record, collapsedCount } = item.row;
                const level = getEventLevel(record.type);
                const { icon: DomainGlyph, color } = domainIcon(record.type);
                const selected = record.id === selectedEventId;
                const summary = getDisplaySummary(record);
                return (
                  <button
                    type="button"
                    key={item.key}
                    className={cn(
                      'off-ev-row off-focusable',
                      level === 'warning' && 'is-warn',
                      level === 'error' && 'is-err',
                      selected && 'is-sel',
                    )}
                    style={{
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${vi.start}px)`,
                      width: '100%',
                    }}
                    onClick={() => toggleSelect(record.id)}
                  >
                    <DomainGlyph aria-hidden className={cn('off-ev-ico', `off-ev-ico-${color}`)} />
                    <span className="off-ev-label">
                      {summary.actor ? <b className="off-ev-actor">{summary.actor}</b> : null}
                      {summary.actor ? ' · ' : ''}
                      {summary.label}
                      {collapsedCount ? <span className="off-ev-x">×{collapsedCount}</span> : null}
                      {record.entity?.label &&
                      record.entity.label !== record.actor &&
                      record.entity.label !== summary.label ? (
                        <span className="off-ev-entity"> — {record.entity.label}</span>
                      ) : null}
                    </span>
                    <span className="off-ev-ts">{formatRelativeTimestamp(record.at)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedRecord ? (
            <ActivityEventDetail record={selectedRecord} onClose={() => setSelectedEventId(null)} />
          ) : null}
        </div>
      )}
    </div>
  );
}
