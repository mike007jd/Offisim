import { reposOrNull } from '@/data/adapters.js';
import { CapsLabel } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import { cn } from '@/lib/utils.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Cpu, Plug, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ExternalEmployeesPane } from './ExternalEmployeesPane.js';
import { McpServersPane } from './McpServersPane.js';
import { ProviderPane } from './ProviderPane.js';
import { RuntimePane } from './RuntimePane.js';
import { type SaveStatus, SettingsSaveBar } from './SettingsSaveBar.js';
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

const RUNTIME_SETTINGS_KEY = 'settings.runtime.v1';

const NAV: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof Bot }> = [
  { key: 'provider', label: 'Provider', icon: Bot },
  { key: 'runtime', label: 'Runtime', icon: Cpu },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'external', label: 'External Employees', icon: Users },
];

function providerProtocol(product: string): 'anthropic' | 'openai' | 'openai-compat' {
  if (product === 'minimax' || product === 'anthropic') return 'anthropic';
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

interface PersistedRuntimeSettings {
  runtime: RuntimeFormValues;
  theme: ThemeValue;
  density: DensityValue;
}

function isThemeValue(value: unknown): value is ThemeValue {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isDensityValue(value: unknown): value is DensityValue {
  return value === 'compact' || value === 'normal' || value === 'spacious';
}

function parsePersistedRuntimeSettings(value: string | null): PersistedRuntimeSettings | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Partial<PersistedRuntimeSettings>;
    const runtime = runtimeFormSchema.safeParse(raw.runtime);
    if (!runtime.success) return null;
    return {
      runtime: runtime.data,
      theme: isThemeValue(raw.theme) ? raw.theme : 'system',
      density: isDensityValue(raw.density) ? raw.density : 'normal',
    };
  } catch {
    return null;
  }
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
      provider: providerProtocol(values.product),
      model: values.model.trim(),
      baseUrl,
      secretRef: config.id,
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
  const [savedTheme, setSavedTheme] = useState<ThemeValue>('system');
  const [savedDensity, setSavedDensity] = useState<DensityValue>('normal');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  // Tracks the post-save flash timer so a second save (or unmount) doesn't
  // leave it firing onto stale state and clobbering an in-flight 'saving'.
  const saveStatusFlashTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (saveStatusFlashTimer.current !== null) {
        window.clearTimeout(saveStatusFlashTimer.current);
      }
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
  const runtimeDirty = runtimeForm.formState.isDirty;
  const appearanceDirty = theme !== savedTheme || density !== savedDensity;
  const providerValid = providerForm.formState.isValid;
  const runtimeValid = runtimeForm.formState.isValid;

  const dirtyScopes = useMemo(() => {
    const scopes: string[] = [];
    if (providerDirty) scopes.push('provider');
    if (runtimeDirty || appearanceDirty) scopes.push('runtime');
    return scopes;
  }, [appearanceDirty, providerDirty, runtimeDirty]);

  const anyDirty = dirtyScopes.length > 0;
  const validationBlocked = anyDirty && (!providerValid || !runtimeValid);

  // Derive the resting save status from form dirtiness (error/saving states are
  // set imperatively in onSave and kept until resolved).
  useEffect(() => {
    setSaveStatus((current) => {
      if (current === 'saving' || current === 'post-save' || current === 'error') return current;
      return anyDirty ? 'dirty' : 'idle';
    });
  }, [anyDirty]);

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
    },
    [providerForm],
  );

  const onSave = useCallback(async () => {
    if (!anyDirty || validationBlocked) return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      if (providerDirty) {
        const values = providerForm.getValues();
        const config = resolveActiveProviderConfig(providerConfigs, activeConfigId);
        await persistProviderProfile(config, values);
        await queryClient.invalidateQueries({ queryKey: ['settings', 'provider-configs'] });
      }
      if (runtimeDirty || appearanceDirty) {
        const repos = await reposOrNull();
        if (!repos?.settings) {
          throw new Error('Runtime settings persistence is only available in the desktop runtime');
        }
        await repos.settings.set(
          RUNTIME_SETTINGS_KEY,
          JSON.stringify({
            runtime: runtimeForm.getValues(),
            theme,
            density,
          } satisfies PersistedRuntimeSettings),
        );
      }
      // F/I3: React batches state updates in the same tick, so
      // `setSaveStatus('post-save')` followed by `setSaveStatus('idle')` in
      // the same block never renders `post-save`. Drop the flash through a
      // setTimeout so the SaveBar's "Saved" affordance is actually visible.
      setSaveStatus('post-save');
      providerForm.reset(providerForm.getValues());
      runtimeForm.reset(runtimeForm.getValues());
      setSavedTheme(theme);
      setSavedDensity(density);
      if (saveStatusFlashTimer.current !== null) {
        window.clearTimeout(saveStatusFlashTimer.current);
      }
      saveStatusFlashTimer.current = window.setTimeout(() => {
        saveStatusFlashTimer.current = null;
        // Only fade to idle if we're still showing the post-save flash —
        // a fresh save kicked off in the meantime sets 'saving'/'error',
        // and the resting-status useEffect already moves dirty back to
        // 'dirty' on form mutation.
        setSaveStatus((current) => (current === 'post-save' ? 'idle' : current));
      }, 1200);
      toast.success('Settings saved');
    } catch (error) {
      const message = safeErrorMessage(error);
      setSaveError(message);
      setSaveStatus('error');
      toast.error('Settings save failed', { description: message });
    }
  }, [
    activeConfigId,
    anyDirty,
    appearanceDirty,
    density,
    providerConfigs,
    providerDirty,
    providerForm,
    queryClient,
    runtimeDirty,
    runtimeForm,
    theme,
    validationBlocked,
  ]);

  const onRetry = useCallback(() => {
    setSaveStatus(anyDirty ? 'dirty' : 'idle');
    setSaveError(null);
    void onSave();
  }, [anyDirty, onSave]);

  // ⌘S to save when dirty.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (tab !== 'external') {
          event.preventDefault();
          void onSave();
        }
      }
      if (event.key === 'Escape' && anyDirty) {
        providerForm.reset();
        runtimeForm.reset();
        setTheme(savedTheme);
        setDensity(savedDensity);
        toast('Changes discarded');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab, anyDirty, onSave, providerForm, runtimeForm, savedDensity, savedTheme]);

  const showSaveBar = tab !== 'external';

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
          {tab === 'provider' ? (
            <ProviderPane
              form={providerForm}
              activeConfigId={activeConfigId}
              onSelectConfig={onSelectConfig}
            />
          ) : null}
          {tab === 'runtime' ? (
            <RuntimePane
              form={runtimeForm}
              theme={theme}
              density={density}
              onThemeChange={setTheme}
              onDensityChange={setDensity}
            />
          ) : null}
          {tab === 'mcp' ? <McpServersPane /> : null}
          {tab === 'external' ? <ExternalEmployeesPane /> : null}
        </div>

        {showSaveBar ? (
          <SettingsSaveBar
            status={saveStatus}
            dirtyScopes={dirtyScopes}
            validationBlocked={validationBlocked}
            errorMessage={saveError}
            onSave={() => void onSave()}
            onRetry={onRetry}
          />
        ) : null}
      </div>
    </div>
  );
}
