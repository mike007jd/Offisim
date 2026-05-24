import type { RuntimeEvent } from '@offisim/shared-types';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@offisim/ui-core';
import { useEffect, useRef, useState } from 'react';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';

interface ActivityItem {
  id: string;
  eventType: string;
  entityName: string;
  timestamp: string;
}

const MAX_ITEMS = 10;

/**
 * Displays the last 10 runtime events as a scrollable list.
 * Subscribes to all events via a wildcard prefix.
 */
export function RecentActivityCard() {
  const { eventBus } = useOffisimRuntimeServices();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let idCounter = 0;

    // Subscribe to broad categories of events
    const prefixes = [
      'employee.state.',
      'task.state.',
      'llm.call.',
      'llm.usage.',
      'plan.',
      'meeting.',
      'error.',
      'install.',
      'mcp.',
    ];

    const unsubs = prefixes.map((prefix) =>
      eventBus.on(prefix, (event: RuntimeEvent<Record<string, unknown>>) => {
        const entityName = extractEntityName(event);
        const newItem: ActivityItem = {
          id: `activity-${++idCounter}`,
          eventType: event.type,
          entityName,
          timestamp: new Date(event.timestamp ?? Date.now()).toISOString(),
        };

        setItems((prev) => {
          const next = [newItem, ...prev];
          return next.length > MAX_ITEMS ? next.slice(0, MAX_ITEMS) : next;
        });
      }),
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [eventBus]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-ink-2">
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-xs text-ink-2/60">No activity yet.</div>
        ) : (
          <div ref={scrollRef} className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-surface-sunken/20"
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <Badge variant="secondary" className="text-caption shrink-0">
                    {shortenEventType(item.eventType)}
                  </Badge>
                  <span className="text-caption text-ink-1 font-mono truncate">
                    {item.entityName}
                  </span>
                </div>
                <span className="text-caption text-ink-2/50 font-mono shrink-0">
                  {formatTime(item.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Extract a human-readable entity name from the event payload. */
function extractEntityName(event: RuntimeEvent<Record<string, unknown>>): string {
  const p = event.payload;
  if (!p || typeof p !== 'object') return '';
  // Try common payload fields
  if ('employeeId' in p && typeof p.employeeId === 'string') return p.employeeId;
  if ('taskRunId' in p && typeof p.taskRunId === 'string') return p.taskRunId;
  if ('model' in p && typeof p.model === 'string') return p.model;
  if ('nodeName' in p && typeof p.nodeName === 'string') return p.nodeName;
  if ('planId' in p && typeof p.planId === 'string') return p.planId;
  return '';
}

/** Shorten event type for badge display. e.g. "employee.state.changed" → "emp.state" */
function shortenEventType(type: string): string {
  const parts = type.split('.');
  if (parts.length <= 2) return type;
  // Take first 3 chars of first segment + rest
  const prefix = (parts[0] ?? '').slice(0, 3);
  return `${prefix}.${parts.slice(1).join('.')}`;
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}
