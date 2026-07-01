import { reposOrNull } from '@/data/adapters.js';
import { CapsLabel } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Bot, CheckCircle2, Cpu, KeyRound, Plug, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ExternalEmployeesPane } from './ExternalEmployeesPane.js';
import { McpServersPane } from './McpServersPane.js';
import { PiAgentPane } from './PiAgentPane.js';
import { RuntimePane } from './RuntimePane.js';
import {
  RUNTIME_SETTINGS_KEY,
  parsePersistedRuntimeSettings,
  useApplyAppearance,
} from './appearance.js';
import type { DensityValue, ThemeValue } from './settings-data.js';

type SettingsTab = 'providers' | 'runtime' | 'mcp' | 'external';

const NAV: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof Bot }> = [
  { key: 'providers', label: 'Providers', icon: KeyRound },
  { key: 'runtime', label: 'Runtime', icon: Cpu },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'external', label: 'External Employees', icon: Users },
];

function SettingsCompanion({ tab }: { tab: SettingsTab }) {
  if (tab === 'runtime') {
    return (
      <aside className="off-set-companion" aria-label="Runtime summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-k">Effective run mode</div>
          <div className="off-set-comp-main">
            <Icon icon={Cpu} size="sm" />
            Per conversation
          </div>
          <p className="off-set-comp-copy">
            Run mode, model, and thinking level are chosen per conversation from the composer. They
            are the only runtime knobs the Pi Agent session reads.
          </p>
          <div className="off-set-comp-note">
            <Icon icon={ShieldCheck} size="sm" />
            Pi Agent session runtime
          </div>
        </div>
      </aside>
    );
  }

  if (tab === 'mcp') {
    return (
      <aside className="off-set-companion" aria-label="MCP summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-k">Tool layer</div>
          <div className="off-set-comp-main">
            <Icon icon={Plug} size="sm" />
            Pi tools plus MCP
          </div>
          <p className="off-set-comp-copy">
            MCP remains a project tool layer. The agent loop and tool protocol are owned by Pi.
          </p>
        </div>
      </aside>
    );
  }

  if (tab === 'external') {
    return (
      <aside className="off-set-companion" aria-label="External employees summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-k">Visual roles</div>
          <div className="off-set-comp-main">
            <Icon icon={Users} size="sm" />
            External employees
          </div>
          <p className="off-set-comp-copy">
            Employees shape context and theater presentation; they do not own separate model lanes.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="off-set-companion" aria-label="Pi Agent summary">
      <div className="off-set-comp-card">
        <div className="off-set-comp-k">Current engine</div>
        <div className="off-set-comp-main">
          <Icon icon={Bot} size="sm" />
          Pi Agent
        </div>
        <dl className="off-set-comp-list">
          <div>
            <dt>Auth</dt>
            <dd>Pi AuthStorage</dd>
          </div>
          <div>
            <dt>Models</dt>
            <dd>Pi ModelRegistry</dd>
          </div>
          <div>
            <dt>Sessions</dt>
            <dd>Pi SessionManager</dd>
          </div>
        </dl>
        <div className="off-set-comp-note">
          <Icon icon={CheckCircle2} size="sm" />
          Single runtime
        </div>
      </div>
    </aside>
  );
}

export function SettingsSurface() {
  const [tab, setTab] = useState<SettingsTab>('providers');
  const [theme, setTheme] = useState<ThemeValue>('system');
  const [density, setDensity] = useState<DensityValue>('normal');
  useApplyAppearance(theme, density);

  useEffect(() => {
    let cancelled = false;
    async function loadAppearance() {
      const repos = await reposOrNull();
      if (!repos?.settings) return;
      const persisted = parsePersistedRuntimeSettings(
        await repos.settings.get(RUNTIME_SETTINGS_KEY),
      );
      if (!persisted || cancelled) return;
      setTheme(persisted.theme);
      setDensity(persisted.density);
    }
    void loadAppearance();
    return () => {
      cancelled = true;
    };
  }, []);

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
              {tab === 'external' ? <ExternalEmployeesPane /> : null}
            </div>
            <SettingsCompanion tab={tab} />
          </div>
        </div>
      </div>
    </div>
  );
}
