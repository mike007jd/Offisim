import { AlertTriangle, BrainCircuit, Compass, Sparkles } from 'lucide-react';
import {
  type SystemMessageIcon,
  useSystemMessageFeed,
} from '../../runtime/use-system-message-feed';

const ENTRY_STYLES = {
  info: 'border-slate-400/15 bg-white/4 text-slate-200',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-50',
} as const;

const ICON_MAP: Record<SystemMessageIcon, typeof Sparkles> = {
  default: Sparkles,
  approval: AlertTriangle,
  memory: BrainCircuit,
  navigate: Compass,
  context: Sparkles,
};

export function SystemMessageFeed() {
  const { entries, hasMessages } = useSystemMessageFeed();

  if (!hasMessages) return null;

  return (
    <div className="mb-2 grid gap-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`flex items-start gap-3 rounded-2xl border px-3 py-2.5 text-[11px] shadow-[0_8px_24px_rgba(2,6,23,0.12)] ${ENTRY_STYLES[entry.tone]}`}
        >
          {(() => {
            const Icon = ICON_MAP[entry.icon ?? 'default'];
            return <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />;
          })()}
          <div className="min-w-0 space-y-1">
            <p className="font-semibold uppercase tracking-[0.18em] text-[10px]">{entry.title}</p>
            <p className="leading-relaxed text-slate-300">{entry.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
