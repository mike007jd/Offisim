import { useUiState } from '@/app/ui-state.js';
import { CapsLabel } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { ComputerSetupPanel } from '@/surfaces/office/computer/ComputerSetupPanel.js';
import {
  Bot,
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

function SettingsCompanion({ tab }: { tab: SettingsTab }) {
  if (tab === 'runtime') {
    return (
      <aside className="off-set-companion" aria-label="Usage and storage summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={Cpu} size="sm" />
            Usage &amp; storage
          </div>
          <p className="off-set-comp-copy">
            Set usage alerts and manage local data or diagnostics.
          </p>
        </div>
      </aside>
    );
  }

  if (tab === 'mcp') {
    return (
      <aside className="off-set-companion" aria-label="Tools and integrations summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={Plug} size="sm" />
            Tools &amp; integrations
          </div>
          <p className="off-set-comp-copy">Connect tool servers and manage employee access.</p>
        </div>
      </aside>
    );
  }

  if (tab === 'updates') {
    return (
      <aside className="off-set-companion" aria-label="App update summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={Download} size="sm" />
            Private release channel
          </div>
          <p className="off-set-comp-copy">
            Uses the signed-in GitHub CLI without copying credentials.
          </p>
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
            Computer access
          </div>
          <p className="off-set-comp-copy">
            Check computer control readiness and manage employee access.
          </p>
        </div>
      </aside>
    );
  }

  if (tab === 'external') {
    return (
      <aside className="off-set-companion" aria-label="Connected employees summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={Users} size="sm" />
            Connected employees
          </div>
          <p className="off-set-comp-copy">Manage employees connected from external services.</p>
        </div>
      </aside>
    );
  }

  if (tab === 'companion') {
    return (
      <aside className="off-set-companion" aria-label="Codex pets summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={PawPrint} size="sm" />
            Local Codex pets
          </div>
          <p className="off-set-comp-copy">Read-only sync from your local Codex installation.</p>
        </div>
      </aside>
    );
  }

  if (tab === 'advanced') {
    return (
      <aside className="off-set-companion" aria-label="Advanced connection summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-main">
            <Icon icon={Cable} size="sm" />
            Service connections
          </div>
          <p className="off-set-comp-copy">Configure self-hosted endpoints and access tokens.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="off-set-companion" aria-label="AI account summary">
      <div className="off-set-comp-card">
        <div className="off-set-comp-main">
          <Icon icon={Bot} size="sm" />
          Accounts &amp; models
        </div>
        <p className="off-set-comp-copy">Review exact models, native usage, and cost reporting.</p>
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
            <SettingsCompanion tab={tab} />
          </div>
        </div>
      </div>
    </div>
  );
}
