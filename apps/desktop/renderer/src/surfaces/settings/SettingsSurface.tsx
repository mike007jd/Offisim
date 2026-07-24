import { useUiState } from '@/app/ui-state.js';
import { CapsLabel } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { ComputerSetupPanel } from '@/surfaces/office/computer/ComputerSetupPanel.js';
import {
  type Bot,
  Cable,
  Cpu,
  Download,
  MonitorSmartphone,
  PawPrint,
  Plug,
  Users,
  WalletCards,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AdvancedConnectionsPane } from './AdvancedConnectionsPane.js';
import { AiAccountsPane } from './AiAccountsPane.js';
import { CompanionPane } from './CompanionPane.js';
import { ExternalEmployeesPane } from './ExternalEmployeesPane.js';
import { McpServersPane } from './McpServersPane.js';
import { RuntimePane } from './RuntimePane.js';
import { UpdatePane } from './UpdatePane.js';

type SettingsTab =
  | 'providers'
  | 'runtime'
  | 'mcp'
  | 'computer'
  | 'companion'
  | 'external'
  | 'updates'
  | 'advanced';

const NAV: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof Bot }> = [
  { key: 'providers', label: 'AI Accounts', icon: WalletCards },
  { key: 'runtime', label: 'Usage & Storage', icon: Cpu },
  { key: 'mcp', label: 'Tools & Integrations', icon: Plug },
  { key: 'computer', label: 'Computer Access', icon: MonitorSmartphone },
  { key: 'companion', label: 'Codex Pets', icon: PawPrint },
  { key: 'external', label: 'Connected Employees', icon: Users },
  { key: 'updates', label: 'App Updates', icon: Download },
  { key: 'advanced', label: 'Service Connections', icon: Cable },
];

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
              {tab === 'providers' ? <AiAccountsPane /> : null}
              {tab === 'runtime' ? <RuntimePane /> : null}
              {tab === 'mcp' ? <McpServersPane /> : null}
              {tab === 'computer' ? (
                <ComputerSetupPanel onManageToolAccess={() => setTab('mcp')} />
              ) : null}
              {tab === 'companion' ? <CompanionPane /> : null}
              {tab === 'external' ? <ExternalEmployeesPane /> : null}
              {tab === 'updates' ? <UpdatePane /> : null}
              {tab === 'advanced' ? <AdvancedConnectionsPane /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
