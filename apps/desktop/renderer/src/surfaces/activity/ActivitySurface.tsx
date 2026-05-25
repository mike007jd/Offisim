import { useActivityEvents, useUsageSeries } from '@/data/queries.js';
import type { ActivityLevel } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/design-system/grammar/SegmentedControl.js';
import { StatusPill } from '@/design-system/grammar/StatusPill.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { UsageChart } from '@/surfaces/shared/UsageChart.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Activity } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

const LEVEL_TONE: Record<ActivityLevel, 'accent' | 'ok' | 'warn' | 'danger'> = {
  info: 'accent',
  ok: 'ok',
  warn: 'warn',
  error: 'danger',
};

type LevelFilter = 'all' | ActivityLevel;

const FILTERS: ReadonlyArray<SegmentedOption<LevelFilter>> = [
  { value: 'all', label: 'All' },
  { value: 'ok', label: 'Done' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
];

const timeFmt = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' });

export function ActivitySurface() {
  const events = useActivityEvents();
  const usage = useUsageSeries();
  const [filter, setFilter] = useState<LevelFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const list = events.data ?? [];
    return filter === 'all' ? list : list.filter((e) => e.level === filter);
  }, [events.data, filter]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  return (
    <div className="off-activity">
      <div className="off-activity-bar">
        <span className="off-activity-title">Activity</span>
        <span className="off-activity-count">{filtered.length} events</span>
        <span className="ml-auto">
          <SegmentedControl
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            ariaLabel="Filter activity"
          />
        </span>
      </div>

      {usage.data?.length ? (
        <div className="off-activity-usage">
          <CapsLabel>Runs · last 7 days</CapsLabel>
          <UsageChart data={usage.data} />
        </div>
      ) : null}

      {events.isLoading ? (
        <SkeletonRows rows={8} />
      ) : events.isError ? (
        <ErrorState
          title="Couldn't load activity"
          detail="The activity log is unavailable right now."
          onRetry={() => events.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity"
          description={
            filter === 'all'
              ? 'Runs, deliverables, and warnings will appear here.'
              : 'No events match this filter.'
          }
        />
      ) : (
        <div className="off-activity-scroll" ref={scrollRef}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const event = filtered[item.index];
              if (!event) return null;
              return (
                <div
                  key={event.id}
                  className="off-ev-row"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <span className="off-ev-time">{timeFmt.format(event.at)}</span>
                  <StatusPill tone={LEVEL_TONE[event.level]}>{event.level}</StatusPill>
                  <span className="off-ev-main">
                    <span className="off-ev-top">
                      <span className="off-ev-title">{event.title}</span>
                      <span className="off-ev-source">{event.source}</span>
                    </span>
                    <span className="off-ev-detail">{event.detail}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
