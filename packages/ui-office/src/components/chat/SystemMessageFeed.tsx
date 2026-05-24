import { AlertTriangle, Compass, Sparkles } from 'lucide-react';
import {
  type SystemMessageIcon,
  useSystemMessageFeed,
} from '../../runtime/use-system-message-feed';

const ENTRY_STYLES = {
  info: 'info',
  warning: 'warning',
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
    <div className="system-message-feed">
      {entries.map((entry) => (
        <div key={entry.id} className="system-message-entry" data-tone={ENTRY_STYLES[entry.tone]}>
          {(() => {
            const Icon = ICON_MAP[entry.icon ?? 'default'];
            return <Icon data-icon="system-message" aria-hidden="true" />;
          })()}
          <div className="system-message-copy">
            <p className="system-message-title">{entry.title}</p>
            <p className="system-message-detail">{entry.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
