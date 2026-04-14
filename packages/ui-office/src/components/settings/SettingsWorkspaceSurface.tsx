import type {
  ModelProfile,
  RuntimeExecutionMode,
  RuntimePolicyConfig,
  RuntimeToolPermissionsPolicy,
} from '@offisim/shared-types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@offisim/ui-core';
import { Cpu } from 'lucide-react';
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
import { useOffisimRuntimeStatus } from '../../runtime/offisim-runtime-context';
import { useTheme } from '../../theme';
import { McpConfigPanel } from './McpConfigPanel';
import { SettingsProviderTab } from './SettingsProviderTab';
import { SettingsRuntimeTab } from './SettingsRuntimeTab';
import {
  PROVIDER_PRESETS,
  findProviderPresetKeyByConfig,
  getDefaultProviderPresetKey,
  getProviderPreset,
} from './provider-presets';
import { MetricCard, SurfaceCard } from './settings-primitives';

export type SettingsTab = 'provider' | 'runtime' | 'mcp';

interface SettingsWorkspaceControllerOptions {
  isActive: boolean;
  closeOnSave?: boolean;
  onDismiss: () => void;
  onSave: (config: ProviderConfig) => void;
  onSaveSuccess?: () => void;
  onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void;
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
  onToast,
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
  const [isReinitializing, setIsReinitializing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const loadedSnapshotRef = useRef('');
  const pendingSnapshotCaptureRef = useRef(false);
  const savingRef = useRef(false);
  const reinitBaseVersionRef = useRef<number | null>(null);
  const { version: runtimeVersion } = useOffisimRuntimeStatus();

  useEffect(() => {
    if (!isReinitializing || reinitBaseVersionRef.current === null) return;
    if (runtimeVersion > reinitBaseVersionRef.current) {
      setIsReinitializing(false);
      reinitBaseVersionRef.current = null;
    }
  }, [runtimeVersion, isReinitializing]);

  // Separate timeout: fires once when isReinitializing becomes true,
  // not reset by intermediate runtimeVersion bumps.
  useEffect(() => {
    if (!isReinitializing) return;
    const timer = window.setTimeout(() => {
      setIsReinitializing(false);
      reinitBaseVersionRef.current = null;
      setSaveError('Runtime failed to reinitialize. Check your provider settings and try again.');
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isReinitializing]);

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
    if (savingRef.current) return;
    savingRef.current = true;
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
      reinitBaseVersionRef.current = runtimeVersion;
      setIsReinitializing(true);
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
      savingRef.current = false;
    }
  }

  const showBaseURL =
    preset === 'custom' || PROVIDER_PRESETS[preset]?.defaults.baseURL !== undefined;
  const selectedPreset = PROVIDER_PRESETS[preset];
  const isThinkingProvider = selectedPreset?.hasThinking === true;
  const isSaveDisabled =
    isSaving || isReinitializing || !model || (!isSubscription && !apiKey && !hasStoredSecret);
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
    isSaving: isSaving || isReinitializing,
    isSubscription,
    isThinkingProvider,
    memoryConfidenceThreshold,
    memoryEnabled,
    memoryInjectionEnabled,
    memoryMaxFacts,
    model,
    notify: (message: string, variant: 'info' | 'success' | 'error' = 'info') =>
      onToast?.(message, variant),
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

export function SettingsWorkspaceSurface({
  activeTab,
  controller,
  dismissControl,
  onActiveTabChange,
}: SettingsWorkspaceSurfaceProps) {
  const {
    baseURL,
    selectedCapabilities,
    selectedCompatibility,
    selectedPreset,
    selectedRegion,
    selectedSurface,
    selectedVendor,
  } = controller;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#14203d_0%,#0b1121_42%,#040814_100%)] text-slate-100 shadow-[0_30px_120px_rgba(0,0,0,0.52)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-white/10 bg-slate-950/45 px-6 py-5 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.36em] text-cyan-300/80">
                System Control
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                Provider Workspace
              </h1>
            </div>
            {dismissControl}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Official compatibility"
              value={selectedCompatibility}
              detail={selectedPreset?.label ?? 'Custom'}
            />
            <MetricCard
              label="Surface"
              value={selectedSurface}
              detail={`Region: ${selectedRegion}`}
            />
            <MetricCard label="Capabilities" value={selectedCapabilities} detail="Preset-aware" />
            <MetricCard
              label="Endpoint"
              value={baseURL || selectedPreset?.defaults.baseURL || 'Manual'}
              detail={selectedVendor}
            />
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as SettingsTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="border-b border-white/10 bg-slate-950/25 px-6 py-4">
            <TabsList className="grid w-full grid-cols-2 rounded-full border border-white/10 bg-white/[0.03] p-1 md:grid-cols-4">
              <TabsTrigger
                value="provider"
                className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-100"
              >
                Provider Workspace
              </TabsTrigger>
              <TabsTrigger
                value="runtime"
                className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-100"
              >
                Runtime orchestration
              </TabsTrigger>
              <TabsTrigger
                value="mcp"
                className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-100"
              >
                MCP servers
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="provider" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SettingsProviderTab controller={controller} />
          </TabsContent>

          <TabsContent value="runtime" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SettingsRuntimeTab controller={controller} />
          </TabsContent>

          <TabsContent value="mcp" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SurfaceCard title="MCP servers" icon={<Cpu className="h-5 w-5" />}>
              <McpConfigPanel />
            </SurfaceCard>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
