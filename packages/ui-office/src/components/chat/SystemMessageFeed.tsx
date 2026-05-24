import { AlertTriangle, Compass, Sparkles } from 'lucide-react';
import {
  type SystemMessageIcon,
  useSystemMessageFeed,
} from '../../runtime/use-system-message-feed';

const ENTRY_STYLES = {
  info: 'border-accent bg-accent-surface text-accent',
  warning: 'border-warn bg-warn-surface text-warn',
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
          className={`flex items-start gap-3 rounded-r-lg border px-3 py-2.5 text-fs-meta shadow-resting ${ENTRY_STYLES[entry.tone]}`}
        >
          {(() => {
            const Icon = ICON_MAP[entry.icon ?? 'default'];
            return <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />;
          })()}
          <div className="min-w-0 flex flex-col gap-1">
            <p className="font-semibold uppercase tracking-wide text-fs-meta">{entry.title}</p>
            <p className="leading-relaxed text-ink-3">{entry.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
