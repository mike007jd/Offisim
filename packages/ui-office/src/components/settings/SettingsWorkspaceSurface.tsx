import type {
  ModelProfile,
  RuntimeExecutionMode,
  RuntimePolicyConfig,
  RuntimeToolPermissionsPolicy,
} from '@offisim/shared-types';
import { Cpu, Globe, Network, Workflow } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearRuntimeSecret,
  getRuntimeSecretStatus,
  setRuntimeSecret,
} from '../../lib/desktop-provider-secrets';
import { isTauri } from '../../lib/env';
import {
  type ProviderConfig,
  createDefaultRuntimePolicy,
  loadProviderConfig,
  normalizeRuntimePolicy,
  saveProviderConfig,
} from '../../lib/provider-config';
import { useTheme } from '../../theme';
import { OpenClawSettings } from '../openclaw/OpenClawSettings';
import { McpConfigPanel } from './McpConfigPanel';
import { SettingsProviderTab } from './SettingsProviderTab';
import { SettingsRuntimeTab } from './SettingsRuntimeTab';
import {
  PROVIDER_PRESETS,
  findProviderPresetKeyByConfig,
  getDefaultProviderPresetKey,
  getProviderPreset,
} from './provider-presets';
import { SurfaceCard } from './settings-primitives';

export type SettingsTab = 'provider' | 'runtime' | 'mcp' | 'openclaw';

interface SettingsWorkspaceControllerOptions {
  isActive: boolean;
  closeOnSave?: boolean;
  onDismiss: () => void;
  onSave: (config: ProviderConfig) => void;
  onSaveSuccess?: () => void;
}

const DEFAULT_POLICY = createDefaultRuntimePolicy('subscription', '');

const IS_DESKTOP = isTauri();
const DEFAULT_PRESET_KEY = getDefaultProviderPresetKey({ tauri: IS_DESKTOP });

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseConfidence(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function formatCompatibilityLabel(value?: string) {
  switch (value) {
    case 'anthropic':
      return 'Anthropic-compatible';
    case 'openai':
      return 'OpenAI';
    case 'openai-compat':
      return 'OpenAI-compatible';
    case 'native':
      return 'Native transport';
    default:
      return 'Custom surface';
  }
}

function formatSurfaceLabel(value?: string) {
  switch (value) {
    case 'coding-plan':
      return 'Coding plan';
    case 'general':
      return 'General API';
    default:
      return 'Runtime surface';
  }
}

function capabilitySummary(
  capabilities:
    | {
        streaming?: boolean;
        thinking?: boolean;
        toolCalls?: boolean;
        toolStreaming?: boolean;
        codingPlan?: boolean;
      }
    | undefined,
) {
  const labels: string[] = [];
  if (capabilities?.streaming) labels.push('streaming');
  if (capabilities?.thinking) labels.push('thinking');
  if (capabilities?.toolCalls) labels.push('tools');
  if (capabilities?.toolStreaming) labels.push('tool stream');
  if (capabilities?.codingPlan) labels.push('coding plan');
  return labels.length > 0 ? labels.join(' • ') : 'manual configuration';
}

export function useSettingsWorkspaceController({
  isActive,
  closeOnSave = false,
  onDismiss,
  onSave,
  onSaveSuccess,
}: SettingsWorkspaceControllerOptions) {
  const { density, setDensity } = useTheme();
  const [preset, setPreset] = useState<string>(DEFAULT_PRESET_KEY);
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [defaultHeaders, setDefaultHeaders] = useState('');
  const [acpCommand, setAcpCommand] = useState('claude');
  const [executionMode, setExecutionMode] = useState<RuntimeExecutionMode>(
    DEFAULT_POLICY.executionMode,
  );
  const [summarizationEnabled, setSummarizationEnabled] = useState(true);
  const [summarizationTriggerTokens, setSummarizationTriggerTokens] = useState(
    String(DEFAULT_POLICY.summarization.triggerTokens),
  );
  const [summarizationKeepRecentMessages, setSummarizationKeepRecentMessages] = useState(
    String(DEFAULT_POLICY.summarization.keepRecentMessages),
  );
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryInjectionEnabled, setMemoryInjectionEnabled] = useState(true);
  const [memoryMaxFacts, setMemoryMaxFacts] = useState(String(DEFAULT_POLICY.memory.maxFacts));
  const [memoryConfidenceThreshold, setMemoryConfidenceThreshold] = useState(
    String(DEFAULT_POLICY.memory.factConfidenceThreshold),
  );
  const [toolSearchEnabled, setToolSearchEnabled] = useState(true);
  const [gitAutoCommit, setGitAutoCommit] = useState(true);
  const [toolPermissions, setToolPermissions] = useState<RuntimeToolPermissionsPolicy>(
    DEFAULT_POLICY.toolPermissions,
  );
  const [runtimeModelDefault, setRuntimeModelDefault] = useState<ModelProfile>(
    DEFAULT_POLICY.modelPolicy.default,
  );
  const [runtimeModelOverrides, setRuntimeModelOverrides] = useState<
    Record<string, ModelProfile> | undefined
  >(undefined);
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const loadedSnapshotRef = useRef('');
  const pendingSnapshotCaptureRef = useRef(false);

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        preset,
        apiKey,
        baseURL,
        model,
        defaultHeaders,
        acpCommand,
        executionMode,
        summarizationEnabled,
        summarizationTriggerTokens,
        summarizationKeepRecentMessages,
        memoryEnabled,
        memoryInjectionEnabled,
        memoryMaxFacts,
        memoryConfidenceThreshold,
        toolSearchEnabled,
        gitAutoCommit,
        toolPermissions,
        runtimeModelDefault,
        runtimeModelOverrides,
        density,
      }),
    [
      acpCommand,
      apiKey,
      baseURL,
      defaultHeaders,
      density,
      executionMode,
      gitAutoCommit,
      memoryConfidenceThreshold,
      memoryEnabled,
      memoryInjectionEnabled,
      memoryMaxFacts,
      model,
      preset,
      runtimeModelDefault,
      runtimeModelOverrides,
      summarizationEnabled,
      summarizationKeepRecentMessages,
      summarizationTriggerTokens,
      toolPermissions,
      toolSearchEnabled,
    ],
  );

  const hasUnsavedChanges =
    isActive && loadedSnapshotRef.current !== '' && currentSnapshot !== loadedSnapshotRef.current;

  useEffect(() => {
    if (pendingSnapshotCaptureRef.current) {
      loadedSnapshotRef.current = currentSnapshot;
      pendingSnapshotCaptureRef.current = false;
    }
  }, [currentSnapshot]);

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    async function loadState() {
      const saved = loadProviderConfig();
      if (saved) {
        setApiKey(saved.apiKey ?? '');
        setBaseURL(saved.baseURL ?? '');
        setModel(saved.model ?? '');
        setDefaultHeaders(saved.defaultHeaders ? JSON.stringify(saved.defaultHeaders) : '');
        setAcpCommand(saved.acpCommand ?? 'claude');
        const runtimePolicy: RuntimePolicyConfig = normalizeRuntimePolicy(
          saved.runtimePolicy,
          saved.provider,
          saved.model,
        );
        setExecutionMode(runtimePolicy.executionMode);
        setSummarizationEnabled(runtimePolicy.summarization.enabled);
        setSummarizationTriggerTokens(String(runtimePolicy.summarization.triggerTokens));
        setSummarizationKeepRecentMessages(String(runtimePolicy.summarization.keepRecentMessages));
        setMemoryEnabled(runtimePolicy.memory.enabled);
        setMemoryInjectionEnabled(runtimePolicy.memory.injectionEnabled);
        setMemoryMaxFacts(String(runtimePolicy.memory.maxFacts));
        setMemoryConfidenceThreshold(String(runtimePolicy.memory.factConfidenceThreshold));
        setToolSearchEnabled(runtimePolicy.toolSearch.enabled);
        setGitAutoCommit(runtimePolicy.gitAutoCommit ?? true);
        setToolPermissions(runtimePolicy.toolPermissions);
        setRuntimeModelDefault(runtimePolicy.modelPolicy.default);
        setRuntimeModelOverrides(runtimePolicy.modelPolicy.overrides);
        const matchKey = findProviderPresetKeyByConfig(saved);
        if (matchKey) {
          if (!IS_DESKTOP && matchKey === 'subscription') {
            setPreset(DEFAULT_PRESET_KEY);
            setSaveError(
              'Subscription runtime is only available in the desktop app. A browser-safe preset was loaded instead.',
            );
          } else {
            setPreset(matchKey);
          }
        } else {
          setPreset(DEFAULT_PRESET_KEY);
        }
      } else {
        const defaultPreset = getProviderPreset(DEFAULT_PRESET_KEY);
        setPreset(DEFAULT_PRESET_KEY);
        setBaseURL(defaultPreset?.defaults.baseURL ?? '');
        setModel(defaultPreset?.defaults.model ?? '');
        setDefaultHeaders(
          defaultPreset?.defaults.defaultHeaders
            ? JSON.stringify(defaultPreset.defaults.defaultHeaders)
            : '',
        );
        setAcpCommand(defaultPreset?.defaults.acpCommand ?? 'claude');
        setExecutionMode(DEFAULT_POLICY.executionMode);
        setSummarizationEnabled(DEFAULT_POLICY.summarization.enabled);
        setSummarizationTriggerTokens(String(DEFAULT_POLICY.summarization.triggerTokens));
        setSummarizationKeepRecentMessages(String(DEFAULT_POLICY.summarization.keepRecentMessages));
        setMemoryEnabled(DEFAULT_POLICY.memory.enabled);
        setMemoryInjectionEnabled(DEFAULT_POLICY.memory.injectionEnabled);
        setMemoryMaxFacts(String(DEFAULT_POLICY.memory.maxFacts));
        setMemoryConfidenceThreshold(String(DEFAULT_POLICY.memory.factConfidenceThreshold));
        setToolSearchEnabled(DEFAULT_POLICY.toolSearch.enabled);
        setGitAutoCommit(DEFAULT_POLICY.gitAutoCommit ?? true);
        setToolPermissions(DEFAULT_POLICY.toolPermissions);
        setRuntimeModelDefault({
          ...DEFAULT_POLICY.modelPolicy.default,
          provider: defaultPreset?.defaults.provider ?? DEFAULT_POLICY.modelPolicy.default.provider,
          model: defaultPreset?.defaults.model ?? DEFAULT_POLICY.modelPolicy.default.model,
        });
        setRuntimeModelOverrides(DEFAULT_POLICY.modelPolicy.overrides);
      }

      setSaveError('');

      if (isTauri()) {
        try {
          const status = await getRuntimeSecretStatus();
          if (!cancelled) {
            setHasStoredSecret(status.hasSecret);
          }
        } catch {
          if (!cancelled) {
            setHasStoredSecret(false);
          }
        }
      } else {
        setHasStoredSecret(false);
      }

      pendingSnapshotCaptureRef.current = true;
    }

    void loadState();

    return () => {
      cancelled = true;
    };
  }, [isActive]);

  function handlePresetChange(value: string) {
    setPreset(value);
    const providerPreset = getProviderPreset(value);
    if (providerPreset) {
      setBaseURL(providerPreset.defaults.baseURL ?? '');
      setModel(providerPreset.defaults.model ?? '');
      setDefaultHeaders(
        providerPreset.defaults.defaultHeaders
          ? JSON.stringify(providerPreset.defaults.defaultHeaders)
          : '',
      );
      setAcpCommand(providerPreset.defaults.acpCommand ?? 'claude');
      setRuntimeModelDefault((prev) => ({
        ...prev,
        provider: providerPreset.defaults.provider ?? 'openai-compat',
        model: providerPreset.defaults.model ?? '',
      }));
    }
  }

  const isSubscription = preset === 'subscription';

  async function handleSave() {
    setSaveError('');
    try {
      setIsSaving(true);
      const providerPreset = PROVIDER_PRESETS[preset];
      const effectiveBaseURL = baseURL || providerPreset?.defaults.baseURL;

      let parsedHeaders: Record<string, string> | undefined;
      if (defaultHeaders) {
        try {
          parsedHeaders = JSON.parse(defaultHeaders);
        } catch {
          setSaveError('Invalid JSON in Default Headers field.');
          return;
        }
      }

      if (isTauri()) {
        if (isSubscription) {
          await clearRuntimeSecret();
          setHasStoredSecret(false);
        } else if (apiKey.trim()) {
          await setRuntimeSecret(apiKey.trim());
          setHasStoredSecret(true);
        } else if (!hasStoredSecret) {
          setSaveError('API Key is required.');
          return;
        }
      } else if (!isSubscription && !apiKey.trim()) {
        setSaveError('API Key is required.');
        return;
      }

      const runtimePolicy = {
        executionMode,
        modelPolicy: {
          default: {
            ...runtimeModelDefault,
            provider: providerPreset?.defaults.provider ?? 'openai-compat',
            model: isSubscription ? 'default' : model,
            profileName: runtimeModelDefault.profileName || 'runtime-default',
          },
          ...(runtimeModelOverrides ? { overrides: runtimeModelOverrides } : {}),
        },
        summarization: {
          enabled: summarizationEnabled,
          triggerTokens: parsePositiveInt(
            summarizationTriggerTokens,
            DEFAULT_POLICY.summarization.triggerTokens,
          ),
          keepRecentMessages: parseNonNegativeInt(
            summarizationKeepRecentMessages,
            DEFAULT_POLICY.summarization.keepRecentMessages,
          ),
        },
        memory: {
          enabled: memoryEnabled,
          injectionEnabled: memoryInjectionEnabled,
          maxFacts: parsePositiveInt(memoryMaxFacts, DEFAULT_POLICY.memory.maxFacts),
          factConfidenceThreshold: parseConfidence(
            memoryConfidenceThreshold,
            DEFAULT_POLICY.memory.factConfidenceThreshold,
          ),
        },
        toolSearch: {
          enabled: toolSearchEnabled,
        },
        toolPermissions,
        gitAutoCommit,
      };

      const config: ProviderConfig = {
        provider: providerPreset?.defaults.provider ?? 'openai-compat',
        ...(providerPreset
          ? {
              providerVariantId: preset,
              vendor: providerPreset.vendor,
              region: providerPreset.region,
              compatibility: providerPreset.compatibility,
              surface: providerPreset.surface,
              capabilities: providerPreset.capabilities,
            }
          : {}),
        apiKey: isSubscription ? '' : apiKey.trim() || undefined,
        model: isSubscription ? 'default' : model,
        ...(effectiveBaseURL && !isSubscription ? { baseURL: effectiveBaseURL } : {}),
        ...(parsedHeaders
          ? { defaultHeaders: parsedHeaders }
          : providerPreset?.defaults.defaultHeaders
            ? { defaultHeaders: providerPreset.defaults.defaultHeaders }
            : {}),
        ...(isSubscription
          ? {
              acpCommand: acpCommand || 'claude',
              acpArgs: ['acp'],
            }
          : {}),
        runtimePolicy,
      };

      saveProviderConfig(config);
      onSave(loadProviderConfig() ?? config);
      loadedSnapshotRef.current = currentSnapshot;
      if (closeOnSave) {
        onDismiss();
      }
      onSaveSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  const showBaseURL =
    preset === 'custom' || PROVIDER_PRESETS[preset]?.defaults.baseURL !== undefined;
  const selectedPreset = PROVIDER_PRESETS[preset];
  const isThinkingProvider = selectedPreset?.hasThinking === true;
  const isSaveDisabled = isSaving || !model || (!isSubscription && !apiKey && !hasStoredSecret);
  const selectedCompatibility = formatCompatibilityLabel(selectedPreset?.compatibility);
  const selectedSurface = formatSurfaceLabel(selectedPreset?.surface);
  const selectedCapabilities = capabilitySummary(selectedPreset?.capabilities);
  const selectedRegion = selectedPreset?.region?.toUpperCase() ?? 'GLOBAL';
  const selectedVendor = selectedPreset?.vendor ?? 'custom';

  const requestDismiss = useCallback(() => {
    if (
      hasUnsavedChanges &&
      typeof window !== 'undefined' &&
      !window.confirm('Discard unsaved changes in Settings?')
    ) {
      return;
    }
    onDismiss();
  }, [hasUnsavedChanges, onDismiss]);

  return {
    acpCommand,
    apiKey,
    baseURL,
    defaultHeaders,
    density,
    executionMode,
    gitAutoCommit,
    handlePresetChange,
    handleSave,
    hasStoredSecret,
    hasUnsavedChanges,
    isSaveDisabled,
    isSaving,
    isSubscription,
    isThinkingProvider,
    memoryConfidenceThreshold,
    memoryEnabled,
    memoryInjectionEnabled,
    memoryMaxFacts,
    model,
    preset,
    requestDismiss,
    saveError,
    selectedCapabilities,
    selectedCompatibility,
    selectedPreset,
    selectedRegion,
    selectedSurface,
    selectedVendor,
    setAcpCommand,
    setApiKey,
    setBaseURL,
    setDensity,
    setExecutionMode,
    setGitAutoCommit,
    setMemoryConfidenceThreshold,
    setMemoryEnabled,
    setMemoryInjectionEnabled,
    setMemoryMaxFacts,
    setModel,
    setRuntimeModelDefault,
    setSummarizationEnabled,
    setSummarizationKeepRecentMessages,
    setSummarizationTriggerTokens,
    setToolSearchEnabled,
    showBaseURL,
    summarizationEnabled,
    summarizationKeepRecentMessages,
    summarizationTriggerTokens,
    toolSearchEnabled,
  };
}

interface SettingsWorkspaceSurfaceProps {
  activeTab: SettingsTab;
  controller: ReturnType<typeof useSettingsWorkspaceController>;
  dismissControl: ReactNode;
  onActiveTabChange: (tab: SettingsTab) => void;
}

const TAB_ITEMS: { key: SettingsTab; label: string; icon: typeof Cpu }[] = [
  { key: 'provider', label: 'Provider', icon: Globe },
  { key: 'runtime', label: 'Runtime', icon: Cpu },
  { key: 'mcp', label: 'MCP', icon: Network },
  { key: 'openclaw', label: 'Gateway', icon: Workflow },
];

export function SettingsWorkspaceSurface({
  activeTab,
  controller,
  dismissControl: _dismissControl,
  onActiveTabChange,
}: SettingsWorkspaceSurfaceProps) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#0a0e17] text-slate-100">
      {/* Left sidebar — game-style tab navigation */}
      <div className="flex w-52 shrink-0 flex-col border-r border-cyan-400/[0.07] bg-gradient-to-b from-[#0d1220] to-[#080c16]">
        {/* Title header */}
        <div className="px-5 pt-6 pb-4 border-b border-white/[0.04]">
          <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400/60">
            Options
          </h2>
          <p className="mt-1 text-[10px] tracking-wider text-slate-600">OFFISIM v1.6</p>
        </div>

        {/* Tab navigation */}
        <nav className="flex flex-col gap-0.5 px-2 py-3 flex-1">
          {TAB_ITEMS.map(({ key, label, icon: Icon }) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onActiveTabChange(key)}
                className={`group relative flex items-center gap-3 px-4 py-3 text-[13px] font-medium text-left transition-all duration-150 rounded-r-lg ${
                  isActive
                    ? 'bg-cyan-400/[0.08] text-cyan-100'
                    : 'text-slate-500 hover:bg-white/[0.02] hover:text-slate-300'
                }`}
              >
                {/* Active accent bar */}
                {isActive && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.4)]" />
                )}
                <Icon
                  className={`h-4 w-4 shrink-0 transition-colors ${
                    isActive ? 'text-cyan-400' : 'text-slate-600 group-hover:text-slate-400'
                  }`}
                />
                <span className="tracking-wide">{label}</span>
                {/* Subtle right chevron for active */}
                {isActive && <span className="ml-auto text-[10px] text-cyan-400/40">&rsaquo;</span>}
              </button>
            );
          })}
        </nav>

        {/* Save section — game style */}
        <div className="border-t border-white/[0.04] p-3 space-y-2">
          {controller.hasUnsavedChanges && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-400/[0.06] border border-amber-400/10">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
                Unsaved changes
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void controller.handleSave()}
            disabled={controller.isSaveDisabled}
            className={`w-full rounded-lg px-4 py-3 text-[13px] font-bold uppercase tracking-wider transition-all duration-200 ${
              controller.isSaveDisabled
                ? 'bg-slate-800/40 text-slate-600 border border-slate-700/30 cursor-not-allowed'
                : controller.hasUnsavedChanges
                  ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-400/40 shadow-[0_0_20px_rgba(34,211,238,0.1)] hover:bg-cyan-500/30 hover:shadow-[0_0_24px_rgba(34,211,238,0.18)]'
                  : 'bg-cyan-500/10 text-cyan-300/70 border border-cyan-400/20 hover:bg-cyan-500/20 hover:text-cyan-200'
            }`}
          >
            {controller.isSaving ? 'Saving\u2026' : 'Save Changes'}
          </button>
          {controller.saveError && (
            <p className="text-[10px] text-red-400/90 break-words px-1">{controller.saveError}</p>
          )}
        </div>
      </div>

      {/* Right — content area with subtle grid pattern */}
      <div className="relative flex-1 min-h-0 overflow-y-auto">
        {/* Decorative top-bar with active tab name */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/[0.04] bg-[#0a0e17]/90 px-8 py-4 backdrop-blur-md">
          <div className="h-3 w-[2px] rounded-full bg-cyan-400/50" />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-slate-400">
            {TAB_ITEMS.find((t) => t.key === activeTab)?.label ?? 'Settings'}
          </h3>
          <div className="flex-1" />
          <div className="h-[1px] w-12 bg-gradient-to-r from-cyan-400/20 to-transparent" />
        </div>

        <div className="px-8 py-6">
          {activeTab === 'provider' && <SettingsProviderTab controller={controller} />}
          {activeTab === 'runtime' && <SettingsRuntimeTab controller={controller} />}
          {activeTab === 'mcp' && (
            <SurfaceCard
              title="MCP Servers"
              description="Configure MCP endpoint connections."
              icon={<Network className="h-5 w-5" />}
            >
              <McpConfigPanel />
            </SurfaceCard>
          )}
          {activeTab === 'openclaw' && (
            <SurfaceCard
              title="Gateway"
              description="Connect to orchestration gateways."
              icon={<Workflow className="h-5 w-5" />}
            >
              <OpenClawSettings />
            </SurfaceCard>
          )}
        </div>
      </div>
    </div>
  );
}
