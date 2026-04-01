import { Globe, Monitor, Wifi } from 'lucide-react';
import type { LaunchMode } from '../lib/ipc';

interface LaunchPanelProps {
  activeMode: LaunchMode | null;
  launching: boolean;
  onLaunch: (mode: LaunchMode) => void;
}

const MODES: Array<{
  mode: LaunchMode;
  label: string;
  description: string;
  icon: typeof Monitor;
}> = [
  {
    mode: 'desktop',
    label: 'Desktop',
    description: 'Tauri native window',
    icon: Monitor,
  },
  {
    mode: 'web',
    label: 'Web',
    description: 'Browser on localhost:5176',
    icon: Globe,
  },
  {
    mode: 'web_lan',
    label: 'Web + LAN',
    description: 'LAN-accessible at 0.0.0.0:5176',
    icon: Wifi,
  },
];

export function LaunchPanel({ activeMode, launching, onLaunch }: LaunchPanelProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {MODES.map(({ mode, label, description, icon: Icon }) => {
        const isActive = activeMode === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onLaunch(mode)}
            disabled={launching}
            className={`
              flex flex-col items-center gap-2 px-4 py-4 rounded-lg border transition-all
              ${
                isActive
                  ? 'border-[var(--accent-val)] bg-[var(--accent-val)]/10 text-[var(--accent-val)]'
                  : 'border-[var(--border-val)] bg-[var(--surface-light)] text-[var(--text-secondary-val)] hover:border-[var(--text-muted-val)] hover:bg-[var(--surface-lighter)]'
              }
              ${launching ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <Icon size={24} />
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-[var(--text-muted-val)]">{description}</span>
          </button>
        );
      })}
    </div>
  );
}
