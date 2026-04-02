import { LoaderCircle, Sparkles } from 'lucide-react';
import { useSystemMessageFeed } from '../../runtime/use-system-message-feed';

const ENTRY_STYLES = {
  info: 'border-slate-400/15 bg-white/4 text-slate-300',
  warning: 'border-amber-400/20 bg-amber-400/8 text-amber-100',
} as const;

export function SystemMessageFeed() {
  const { entries, hasMessages } = useSystemMessageFeed();

  if (!hasMessages) return null;

  return (
    <div className="mb-2 grid gap-1">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] ${ENTRY_STYLES[entry.tone]}`}
        >
          {entry.id.startsWith('tool-active-') ? (
            <LoaderCircle className="h-3 w-3 shrink-0 animate-spin opacity-80" />
          ) : (
            <Sparkles className="h-3 w-3 shrink-0 opacity-70" />
          )}
          <span className="min-w-0 truncate">{entry.label}</span>
        </div>
      ))}
    </div>
  );
}
