import { useUiState } from '@/app/ui-state.js';
import { CapsLabel } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { ComputerSetupPanel } from '@/surfaces/office/computer/ComputerSetupPanel.js';
import { Bot, Cpu, KeyRound, MonitorSmartphone, Plug, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ExternalEmployeesPane } from './ExternalEmployeesPane.js';
import { McpServersPane } from './McpServersPane.js';
import { PiAgentPane } from './PiAgentPane.js';
import { RuntimePane } from './RuntimePane.js';

type SettingsTab = 'providers' | 'runtime' | 'mcp' | 'computer' | 'external';

const NAV: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof Bot }> = [
  { key: 'providers', label: 'Providers', icon: KeyRound },
  { key: 'runtime', label: 'Runtime', icon: Cpu },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'computer', label: 'Computer Use', icon: MonitorSmartphone },
  { key: 'external', label: 'External Employees', icon: Users },
];

function SettingsCompanion({ tab }: { tab: SettingsTab }) {
  if (tab === 'runtime') {
    return (
      <aside className="off-set-companion" aria-label="Runtime summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={Cpu} size="sm" />
            Session controls
          </div>
          <p className="off-set-comp-copy">
            Choose run mode, model, and thinking in each conversation composer.
          </p>
        </div>
      </aside>
    );
  }

  if (tab === 'mcp') {
    return (
      <aside className="off-set-companion" aria-label="MCP summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={Plug} size="sm" />
            MCP servers
          </div>
          <p className="off-set-comp-copy">Connect tools and manage per-employee access.</p>
        </div>
      </aside>
    );
  }

  if (tab === 'computer') {
    return (
      <aside className="off-set-companion" aria-label="Computer Use summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={MonitorSmartphone} size="sm" />
            Driver &amp; access
          </div>
          <p className="off-set-comp-copy">
            Check driver readiness and manage per-employee Computer Use access.
          </p>
        </div>
      </aside>
    );
  }

  if (tab === 'external') {
    return (
      <aside className="off-set-companion" aria-label="External employees summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={Users} size="sm" />
            External employees
          </div>
          <p className="off-set-comp-copy">Manage connected A2A employees.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="off-set-companion" aria-label="Provider summary">
      <div className="off-set-comp-card">
        <div className="off-set-comp-main">
          <Icon icon={Bot} size="sm" />
          Agent runtime
        </div>
        <p className="off-set-comp-copy">
          Credentials and model configuration are read from <span className="off-mono">~/.pi</span>.
        </p>
      </div>
    </aside>
  );
}

export function SettingsSurface() {
  // Appearance (theme/density) is applied app-wide by useLoadPersistedAppearance
  // at the app root (App.tsx); Settings holds no local copy since there is no
  // control to change it (the design system is light-only today).
  const [tab, setTab] = useState<SettingsTab>('providers');
  // Composer `/` routes (e.g. /tool, /computer) deep-link via openSettings(section);
  // land on that section, then clear the pending request so it fires once.
  const settingsSection = useUiState((s) => s.settingsSection);
  const clearSettingsSection = useUiState((s) => s.clearSettingsSection);
  useEffect(() => {
    if (settingsSection && NAV.some((item) => item.key === settingsSection)) {
      setTab(settingsSection as SettingsTab);
    }
    if (settingsSection) clearSettingsSection();
  }, [settingsSection, clearSettingsSection]);

  return (
    <div className="off-settings">
      <nav className="off-settings-nav" aria-label="Settings sections">
        <CapsLabel className="off-settings-nav-head">Settings</CapsLabel>
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn('off-focusable', item.key === tab && 'is-active')}
            onClick={() => setTab(item.key)}
          >
            <Icon icon={item.icon} size="sm" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="off-set-main">
        <div className="off-set-scroll">
          <div className="off-set-workspace">
            <div className="off-set-primary">
              {tab === 'providers' ? <PiAgentPane /> : null}
              {tab === 'runtime' ? <RuntimePane /> : null}
              {tab === 'mcp' ? <McpServersPane /> : null}
              {tab === 'computer' ? (
                <ComputerSetupPanel onManageToolAccess={() => setTab('mcp')} />
              ) : null}
              {tab === 'external' ? <ExternalEmployeesPane /> : null}
            </div>
            <SettingsCompanion tab={tab} />
          </div>
        </div>
      </div>
    </div>
  );
}
