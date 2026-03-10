import type { RuntimeEvent } from '@aics/shared-types';
import { AlertCircle, CheckCircle, Play } from 'lucide-react';

function relativeTime(ts: number): string {
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

interface EventItemProps {
  event: RuntimeEvent;
}

export function EventItem({ event }: EventItemProps) {
  const isEntered = event.type.includes('entered');
  const isError = event.type.includes('error');
  const nodeName = (event.payload as { nodeName?: string }).nodeName ?? event.entityId;

  const Icon = isError ? AlertCircle : isEntered ? Play : CheckCircle;
  const iconColor = isError ? 'text-lobster-red' : isEntered ? 'text-sea-blue' : 'text-kelp-green';

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sand">{nodeName}</span>
        <span className="text-shell ml-1">{isEntered ? 'started' : 'completed'}</span>
      </div>
      <span className="text-shell shrink-0">{relativeTime(event.timestamp)}</span>
    </div>
  );
}
