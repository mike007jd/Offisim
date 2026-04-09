import type { RuntimeEvent } from '@offisim/shared-types';
import { Activity } from 'lucide-react';
import { formatTimestamp } from '../../lib/format-time';
import { domainIcon, getDisplayLabel } from './EventItem';
import type { EventDisplayLevel } from './EventLog';

export interface ActivityEventRowProps {
  event: RuntimeEvent;
  level: EventDisplayLevel;
  selected: boolean;
  onClick: () => void;
}

const LEVEL_LEFT_BORDER: Record<EventDisplayLevel, string> = {
  Error: 'border-l-[4px] border-red-500',
  Warning: 'border-l-[4px] border-amber-500',
  Info: '',
};

const LEVEL_BAR_COLOR: Record<EventDisplayLevel, string> = {
  Error: 'bg-red-500',
  Warning: 'bg-amber-500',
  Info: 'bg-transparent',
};

export function ActivityEventRow({ event, level, selected, onClick }: ActivityEventRowProps) {
  const domain = domainIcon(event.type);
  const Icon = domain?.Icon ?? Activity;
  const iconColor = domain?.color ?? 'text-slate-400';
  const label = getDisplayLabel(event);

  const selectedStyle = selected ? 'bg-white/[0.06]' : '';
  const levelBorder = LEVEL_LEFT_BORDER[level];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 h-12 text-left transition-colors hover:bg-white/[0.04] ${selectedStyle} ${levelBorder}`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
      <span className="flex-1 truncate text-sm text-slate-200">{label}</span>
      <span className="shrink-0 text-xs text-slate-500 w-20 text-right">
        {formatTimestamp(event.timestamp)}
      </span>
      <span className={`shrink-0 w-1 h-6 rounded-full ${LEVEL_BAR_COLOR[level]}`} />
    </button>
  );
}
