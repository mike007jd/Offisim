import { reposOrNull } from '@/data/adapters.js';
import { CapsLabel } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import { cn } from '@/lib/utils.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, Cpu, Plug, Route, ShieldCheck, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ExternalEmployeesPane } from './ExternalEmployeesPane.js';
import { McpServersPane } from './McpServersPane.js';
import { ProviderPane } from './ProviderPane.js';
import { RuntimePane } from './RuntimePane.js';
import {
  type PersistedRuntimeSettings,
  RUNTIME_SETTINGS_KEY,
  parsePersistedRuntimeSettings,
  useApplyAppearance,
} from './appearance.js';
import {
  type DensityValue,
  PROVIDER_CONFIGS,
  type ProviderConfig,
  type ProviderFormValues,
  RUNTIME_DEFAULTS,
  type RuntimeFormValues,
  type ThemeValue,
  providerDefaults,
  providerFormSchema,
  resolveActiveProviderConfig,
  runtimeFormSchema,
  useProviderConfigs,
} from './settings-data.js';

type SettingsTab = 'provider' | 'runtime' | 'mcp' | 'external';

const NAV: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof Bot }> = [
  { key: 'provider', label: 'Provider', icon: Bot },
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
  provider,
  runtime,
  providerDirty,
  providerSaved,
  runtimeSaved,
}: {
  tab: SettingsTab;
  provider: ProviderConfig;
  runtime: RuntimeFormValues;
  providerDirty: boolean;
  providerSaved: boolean;
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
              <dt>Execution lane</dt>
              <dd>{runtime.defaultRuntime === 'gateway' ? 'Desktop lane' : runtime.defaultRuntime}</dd>
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
            Local MCP registry
          </div>
          <p className="off-set-comp-copy">
            Stdio servers require command review. SSE servers stay registered here and connect from
            the web runtime.
          </p>
        </div>
      </aside>
    );
  }

  if (tab === 'external') {
    return (
      <aside className="off-set-companion" aria-label="External employees summary">
        <div className="off-set-comp-card">
          <div className="off-set-comp-k">Extension lane</div>
          <div className="off-set-comp-main">
            <Icon icon={Users} size="sm" />
            External employees
          </div>
          <p className="off-set-comp-copy">
            Installed employees appear in Personnel and use the same workspace, memory, and runtime
            boundaries as first-party staff.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="off-set-companion" aria-label="Provider summary">
      <div className="off-set-comp-card">
        <div className="off-set-comp-k">Current route</div>
        <div className="off-set-comp-main">
          <Icon icon={Bot} size="sm" />
          {provider.displayName}
        </div>
        <dl className="off-set-comp-list">
          <div>
            <dt>Model</dt>
            <dd>{provider.model}</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd>{provider.endpointKind}</dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>{provider.region}</dd>
          </div>
        </dl>
        <div className="off-set-comp-note">
          <Icon icon={providerDirty ? Route : CheckCircle2} size="sm" />
          {providerDirty ? 'Pending provider edits' : providerSaved ? 'Provider saved' : 'Ready'}
        </div>
      </div>
    </aside>
  );
}

function providerProtocol(
  config: ProviderConfig,
  product: string,
): 'anthropic' | 'openai' | 'openai-compat' {
  if (product !== config.product) {
    if (product === 'anthropic' || product === 'minimax') return 'anthropic';
    if (product === 'openai') return 'openai';
    return 'openai-compat';
  }
  if (config.endpointKind === 'messages') return 'anthropic';
  if (product === 'openai') return 'openai';
  return 'openai-compat';
}

function isLoopbackEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function providerBaseUrl(config: ProviderConfig, values: ProviderFormValues): string {
  const override = values.endpointOverride.trim();
  if (override) return override.replace(/\/$/u, '');
  return config.credentialDestination.replace(/\/$/u, '');
}

async function persistProviderProfile(config: ProviderConfig, values: ProviderFormValues) {
  const { invoke } = await import('@tauri-apps/api/core');
  const secret = values.apiKey.trim();
  if (secret) {
    await invoke('runtime_secret_set', { secret });
  }
  const baseUrl = providerBaseUrl(config, values);
  await invoke('runtime_provider_profile_upsert', {
    req: {
      id: config.id,
      displayName: config.displayName,
      provider: providerProtocol(config, values.product),
      model: values.model.trim(),
      baseUrl,
      secretRef: config.secretRef ?? config.id,
      localEndpoint: isLoopbackEndpoint(baseUrl),
    },
  });
}

export function SettingsSurface() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>('provider');
  const [activeConfigId, setActiveConfigId] = useState(PROVIDER_CONFIGS[0].id);
  const providerConfigsQuery = useProviderConfigs();
  const providerConfigs = providerConfigsQuery.data ?? [...PROVIDER_CONFIGS];
  const [theme, setTheme] = useState<ThemeValue>('system');
  const [density, setDensity] = useState<DensityValue>('normal');
  // Apply the current (possibly unsaved) appearance to the document live, so
  // editing Theme/Density reflects immediately rather than only after save.
  useApplyAppearance(theme, density);
  const [savedTheme, setSavedTheme] = useState<ThemeValue>('system');
  const [savedDensity, setSavedDensity] = useState<DensityValue>('normal');

  // Save model: Provider is an explicit commit (it writes a credential, and a
  // half-typed key auto-saved would clobber the stored one). Runtime and
  // Appearance are preferences and auto-save on change. There is no global save
  // bar — each pane owns its own persistence.
  const [providerSave, setProviderSave] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [providerSaveError, setProviderSaveError] = useState<string | null>(null);
  const [runtimeSaved, setRuntimeSaved] = useState(false);
  const providerFlashTimer = useRef<number | null>(null);
  const runtimeFlashTimer = useRef<number | null>(null);
  const runtimeSaveTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (providerFlashTimer.current !== null) window.clearTimeout(providerFlashTimer.current);
      if (runtimeFlashTimer.current !== null) window.clearTimeout(runtimeFlashTimer.current);
      if (runtimeSaveTimer.current !== null) window.clearTimeout(runtimeSaveTimer.current);
    },
    [],
  );

  const providerForm = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: providerDefaults(PROVIDER_CONFIGS[0]),
    mode: 'onChange',
  });
  const runtimeForm = useForm<RuntimeFormValues>({
    resolver: zodResolver(runtimeFormSchema),
    defaultValues: RUNTIME_DEFAULTS,
    mode: 'onChange',
  });

  const providerDirty = providerForm.formState.isDirty;
  const providerValid = providerForm.formState.isValid;
  const runtimeDirty = runtimeForm.formState.isDirty;
  const runtimeValid = runtimeForm.formState.isValid;
  const appearanceDirty = theme !== savedTheme || density !== savedDensity;
  const runtimeValues = runtimeForm.watch();
  const activeProviderConfig = resolveActiveProviderConfig(providerConfigs, activeConfigId);

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

  const onSelectConfig = useCallback(
    (config: ProviderConfig) => {
      setActiveConfigId(config.id);
      providerForm.reset(providerDefaults(config));
      setProviderSave('idle');
      setProviderSaveError(null);
    },
    [providerForm],
  );

  const saveProvider = useCallback(async () => {
    if (!providerDirty || !providerValid) return;
    setProviderSave('saving');
    setProviderSaveError(null);
    try {
      const values = providerForm.getValues();
      const config = resolveActiveProviderConfig(providerConfigs, activeConfigId);
      await persistProviderProfile(config, values);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'provider-configs'] });
      providerForm.reset(providerForm.getValues());
      setProviderSave('saved');
      if (providerFlashTimer.current !== null) window.clearTimeout(providerFlashTimer.current);
      providerFlashTimer.current = window.setTimeout(() => {
        providerFlashTimer.current = null;
        setProviderSave((current) => (current === 'saved' ? 'idle' : current));
      }, 1400);
      toast.success('Provider saved');
    } catch (error) {
      const message = safeErrorMessage(error);
      setProviderSaveError(message);
      setProviderSave('idle');
      toast.error('Provider save failed', { description: message });
    }
  }, [activeConfigId, providerConfigs, providerDirty, providerForm, providerValid, queryClient]);

  const persistRuntime = useCallback(async () => {
    const repos = await reposOrNull();
    if (!repos?.settings) return; // preview build has nothing to persist to
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
    if (runtimeFlashTimer.current !== null) window.clearTimeout(runtimeFlashTimer.current);
    runtimeFlashTimer.current = window.setTimeout(() => {
      runtimeFlashTimer.current = null;
      setRuntimeSaved(false);
    }, 1400);
  }, [density, runtimeForm, theme]);

  // Auto-save runtime + appearance, debounced. A stable serialized snapshot is
  // the trigger so unrelated re-renders (e.g. provider editing) don't keep
  // resetting the timer.
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

  // ⌘S commits the Provider pane; Escape discards its pending edits. Runtime
  // auto-saves, so neither shortcut applies there.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (tab === 'provider') {
          event.preventDefault();
          if (!providerDirty) return;
          if (!providerValid) {
            toast.error('Fix the highlighted provider fields before saving');
            return;
          }
          void saveProvider();
        }
      }
      if (event.key === 'Escape' && tab === 'provider' && providerDirty) {
        providerForm.reset(
          providerDefaults(resolveActiveProviderConfig(providerConfigs, activeConfigId)),
        );
        setProviderSave('idle');
        setProviderSaveError(null);
        toast('Provider changes discarded');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    tab,
    saveProvider,
    providerDirty,
    providerValid,
    providerForm,
    activeConfigId,
    providerConfigs,
  ]);

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
              {tab === 'provider' ? (
                <ProviderPane
                  form={providerForm}
                  activeConfigId={activeConfigId}
                  onSelectConfig={onSelectConfig}
                  dirty={providerDirty}
                  valid={providerValid}
                  saving={providerSave === 'saving'}
                  saved={providerSave === 'saved'}
                  saveError={providerSaveError}
                  onSave={() => void saveProvider()}
                />
              ) : null}
              {tab === 'runtime' ? <RuntimePane form={runtimeForm} saved={runtimeSaved} /> : null}
              {tab === 'mcp' ? <McpServersPane /> : null}
              {tab === 'external' ? <ExternalEmployeesPane /> : null}
            </div>
            <SettingsCompanion
              tab={tab}
              provider={activeProviderConfig}
              runtime={runtimeValues}
              providerDirty={providerDirty}
              providerSaved={providerSave === 'saved'}
              runtimeSaved={runtimeSaved}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
