import { AlertTriangle, Compass, Sparkles } from 'lucide-react';
import {
  type SystemMessageIcon,
  useSystemMessageFeed,
} from '../../runtime/use-system-message-feed';

const ENTRY_STYLES = {
  info: 'border-info bg-info-muted text-info',
  warning: 'border-warning bg-warning-muted text-warning',
} as const;

const ICON_MAP: Record<SystemMessageIcon, typeof Sparkles> = {
  default: Sparkles,
  approval: AlertTriangle,
  navigate: Compass,
};

export function SystemMessageFeed() {
  const { entries, hasMessages } = useSystemMessageFeed();

  if (!hasMessages) return null;

  return (
    <div className="mb-2 grid gap-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`flex items-start gap-3 rounded-2xl border px-3 py-2.5 text-[11px] shadow-resting ${ENTRY_STYLES[entry.tone]}`}
        >
          {(() => {
            const Icon = ICON_MAP[entry.icon ?? 'default'];
            return <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />;
          })()}
          <div className="min-w-0 space-y-1">
            <p className="font-semibold uppercase tracking-[0.18em] text-[10px]">{entry.title}</p>
            <p className="leading-relaxed text-text-secondary">{entry.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
