import { CapsLabel } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bot, Cpu, Plug, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  runtimeFormSchema,
} from './settings-data.js';

type SettingsTab = 'provider' | 'runtime' | 'mcp' | 'external';

const NAV: ReadonlyArray<{ key: SettingsTab; label: string; icon: typeof Bot }> = [
  { key: 'provider', label: 'Provider', icon: Bot },
  { key: 'runtime', label: 'Runtime', icon: Cpu },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'external', label: 'External Employees', icon: Users },
];

export function SettingsSurface() {
  const [tab, setTab] = useState<SettingsTab>('provider');
  const [activeConfigId, setActiveConfigId] = useState(PROVIDER_CONFIGS[0].id);
  const [theme, setTheme] = useState<ThemeValue>('system');
  const [density, setDensity] = useState<DensityValue>('normal');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

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
  const providerValid = providerForm.formState.isValid;
  const runtimeValid = runtimeForm.formState.isValid;

  const dirtyScopes = useMemo(() => {
    const scopes: string[] = [];
    if (providerDirty) scopes.push('provider');
    if (runtimeDirty) scopes.push('runtime');
    return scopes;
  }, [providerDirty, runtimeDirty]);

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
    // Reinitialize phase only when provider/runtime defaults changed.
    await new Promise((resolve) => setTimeout(resolve, 320));
    setSaveStatus('post-save');
    await new Promise((resolve) => setTimeout(resolve, 360));
    // Persist: snapshot the current values as the new pristine baseline.
    providerForm.reset(providerForm.getValues());
    runtimeForm.reset(runtimeForm.getValues());
    setSaveStatus('idle');
    toast.success('Settings saved');
  }, [anyDirty, validationBlocked, providerForm, runtimeForm]);

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
        toast('Changes discarded');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab, anyDirty, onSave, providerForm, runtimeForm]);

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
