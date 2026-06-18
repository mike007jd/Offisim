import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { CapsLabel } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bot, CheckCircle2, Cpu, Plug, ShieldCheck, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ExternalEmployeesPane } from './ExternalEmployeesPane.js';
import { McpServersPane } from './McpServersPane.js';
import { PiAgentPane } from './PiAgentPane.js';
import { RuntimePane } from './RuntimePane.js';
import {
  type PersistedRuntimeSettings,
  RUNTIME_SETTINGS_KEY,
  parsePersistedRuntimeSettings,
  useApplyAppearance,
} from './appearance.js';
import {
  type DensityValue,
  RUNTIME_DEFAULTS,
  type RuntimeFormValues,
  type ThemeValue,
  runtimeFormSchema,
} from './settings-data.js';

type SettingsTab = 'pi-agent' | 'runtime' | 'mcp' | 'external';

const NAV: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof Bot }> = [
  { key: 'pi-agent', label: 'Pi Agent', icon: Bot },
  { key: 'runtime', label: 'Runtime', icon: Cpu },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'external', label: 'External Employees', icon: Users },
];

const RUN_MODE_LABELS: Record<string, string> = {
  plan: 'Plan',
  human_loop: 'Human-in-loop',
  direct: 'Direct',
  yolo: 'YOLO',
  auto: 'Direct',
  manual: 'Human-in-loop',
  review: 'Human-in-loop',
};

function SettingsCompanion({
  tab,
  runtime,
  runtimeSaved,
}: {
  tab: SettingsTab;
  runtime: RuntimeFormValues;
  runtimeSaved: boolean;
}) {
  if (tab === 'runtime') {
    return (
      <aside className="off-set-companion" aria-label="Runtime summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-k">Effective run mode</div>
          <div className="off-set-comp-main">
            <Icon icon={Cpu} size="sm" />
            {RUN_MODE_LABELS[runtime.executionMode] ?? 'Direct'}
          </div>
          <dl className="off-set-comp-list">
            <div>
              <dt>Tool discovery</dt>
              <dd>{runtime.toolSearch === 'enabled' ? 'Enabled' : 'Disabled'}</dd>
            </div>
            <div>
              <dt>Auto-commit</dt>
              <dd>{runtime.gitAutoCommit === 'enabled' ? 'Enabled' : 'Disabled'}</dd>
            </div>
            <div>
              <dt>Runtime engine</dt>
              <dd>Pi Agent</dd>
            </div>
          </dl>
          <div className="off-set-comp-note">
            <Icon icon={ShieldCheck} size="sm" />
            {runtimeSaved ? 'Saved locally' : 'Local policy preview'}
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
  const [tab, setTab] = useState<SettingsTab>('pi-agent');
  const [theme, setTheme] = useState<ThemeValue>('system');
  const [density, setDensity] = useState<DensityValue>('normal');
  useApplyAppearance(theme, density);
  const [savedTheme, setSavedTheme] = useState<ThemeValue>('system');
  const [savedDensity, setSavedDensity] = useState<DensityValue>('normal');
  const [runtimeSaved, setRuntimeSaved] = useState(false);
  const runtimeFlashTimer = useRef<number | null>(null);
  const runtimeSaveTimer = useRef<number | null>(null);
  const companyId = useUiState((s) => s.companyId);

  const runtimeForm = useForm<RuntimeFormValues>({
    resolver: zodResolver(runtimeFormSchema),
    defaultValues: RUNTIME_DEFAULTS,
    mode: 'onChange',
  });

  const runtimeDirty = runtimeForm.formState.isDirty;
  const runtimeValid = runtimeForm.formState.isValid;
  const appearanceDirty = theme !== savedTheme || density !== savedDensity;
  const runtimeValues = runtimeForm.watch();

  useEffect(
    () => () => {
      if (runtimeFlashTimer.current !== null) window.clearTimeout(runtimeFlashTimer.current);
      if (runtimeSaveTimer.current !== null) window.clearTimeout(runtimeSaveTimer.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadRuntimeSettings() {
      const repos = await reposOrNull();
      if (!repos?.settings) return;
      const persisted = parsePersistedRuntimeSettings(
        await repos.settings.get(RUNTIME_SETTINGS_KEY),
      );
      if (!persisted || cancelled) return;
      runtimeForm.reset(persisted.runtime);
      setTheme(persisted.theme);
      setDensity(persisted.density);
      setSavedTheme(persisted.theme);
      setSavedDensity(persisted.density);
    }
    void loadRuntimeSettings();
    return () => {
      cancelled = true;
    };
  }, [runtimeForm]);

  const persistRuntime = useCallback(async () => {
    const repos = await reposOrNull();
    if (!repos?.settings) return;
    await repos.settings.set(
      RUNTIME_SETTINGS_KEY,
      JSON.stringify({
        runtime: runtimeForm.getValues(),
        theme,
        density,
      } satisfies PersistedRuntimeSettings),
    );
    runtimeForm.reset(runtimeForm.getValues());
    setSavedTheme(theme);
    setSavedDensity(density);
    setRuntimeSaved(true);
    if (companyId) {
      const { disposeDesktopAgentRuntime } = await import('@/runtime/desktop-agent-runtime.js');
      await disposeDesktopAgentRuntime(companyId).catch(() => undefined);
    }
    if (runtimeFlashTimer.current !== null) window.clearTimeout(runtimeFlashTimer.current);
    runtimeFlashTimer.current = window.setTimeout(() => {
      runtimeFlashTimer.current = null;
      setRuntimeSaved(false);
    }, 1400);
  }, [companyId, density, runtimeForm, theme]);

  const runtimeAutosaveSnapshot = JSON.stringify({
    runtime: runtimeForm.watch(),
    theme,
    density,
  });
  useEffect(() => {
    if (!runtimeAutosaveSnapshot) return;
    if (!runtimeValid) return;
    if (!runtimeDirty && !appearanceDirty) return;
    if (runtimeSaveTimer.current !== null) window.clearTimeout(runtimeSaveTimer.current);
    runtimeSaveTimer.current = window.setTimeout(() => {
      runtimeSaveTimer.current = null;
      void persistRuntime();
    }, 600);
    return () => {
      if (runtimeSaveTimer.current !== null) {
        window.clearTimeout(runtimeSaveTimer.current);
        runtimeSaveTimer.current = null;
      }
    };
  }, [runtimeAutosaveSnapshot, runtimeDirty, appearanceDirty, runtimeValid, persistRuntime]);

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
              {tab === 'pi-agent' ? <PiAgentPane /> : null}
              {tab === 'runtime' ? <RuntimePane form={runtimeForm} saved={runtimeSaved} /> : null}
              {tab === 'mcp' ? <McpServersPane /> : null}
              {tab === 'external' ? <ExternalEmployeesPane /> : null}
            </div>
            <SettingsCompanion tab={tab} runtime={runtimeValues} runtimeSaved={runtimeSaved} />
          </div>
        </div>
      </div>
    </div>
  );
}
