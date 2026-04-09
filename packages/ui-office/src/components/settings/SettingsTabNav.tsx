import type { LucideIcon } from 'lucide-react';
import { Bot, Cpu, Plug, Workflow } from 'lucide-react';
import type { SettingsTab } from './SettingsWorkspaceSurface';

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string; icon: LucideIcon }> = [
  { key: 'provider', label: 'Provider', icon: Bot },
  { key: 'runtime', label: 'Runtime', icon: Cpu },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'openclaw', label: 'Gateway', icon: Workflow },
];

interface SettingsTabNavProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsTabNav({ activeTab, onTabChange }: SettingsTabNavProps) {
  return (
    <nav className="w-56 flex-shrink-0 border-r border-white/10 bg-slate-950/60 py-6">
      {SETTINGS_TABS.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={`w-full h-12 flex items-center gap-3 px-5 text-sm transition-colors border-l-[4px] ${
              isActive
                ? 'border-cyan-400 bg-white/[0.06] text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
