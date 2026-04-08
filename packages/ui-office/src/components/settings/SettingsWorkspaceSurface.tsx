import type {
  ModelProfile,
  RuntimeExecutionMode,
  RuntimePolicyConfig,
  RuntimeToolPermissionsPolicy,
} from '@offisim/shared-types';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@offisim/ui-core';
import { Bot, BrainCircuit, Cpu, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  PROVIDER_PRESETS,
  findProviderPresetKeyByConfig,
  getAvailableProviderPresets,
  getDefaultProviderPresetKey,
  getProviderPreset,
} from './provider-presets';

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
const AVAILABLE_PRESETS = getAvailableProviderPresets({ tauri: IS_DESKTOP });

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
        tool_calls?: boolean;
        tool_stream?: boolean;
        coding_plan?: boolean;
      }
    | undefined,
) {
  const labels: string[] = [];
  if (capabilities?.streaming) labels.push('streaming');
  if (capabilities?.thinking) labels.push('thinking');
  if (capabilities?.tool_calls) labels.push('tools');
  if (capabilities?.tool_stream) labels.push('tool stream');
  if (capabilities?.coding_plan) labels.push('coding plan');
  return labels.length > 0 ? labels.join(' • ') : 'manual configuration';
}

function SurfaceCard({
  title,
  description,
  icon,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[24px] border border-white/10 bg-slate-950/45 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400">
            {title}
          </p>
          {description ? <p className="mt-2 text-sm text-slate-300">{description}</p> : null}
        </div>
        {icon ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-100">
            {icon}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function SectionLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400"
    >
      {children}
    </label>
  );
}

function surfaceInputProps(className = '') {
  return `h-11 rounded-2xl border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-400/40 ${className}`;
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

  const requestDismiss = () => {
    if (
      hasUnsavedChanges &&
      typeof window !== 'undefined' &&
      !window.confirm('Discard unsaved changes in Settings?')
    ) {
      return;
    }
    onDismiss();
  };

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

export function SettingsWorkspaceSurface({
  activeTab,
  controller,
  dismissControl,
  onActiveTabChange,
}: SettingsWorkspaceSurfaceProps) {
  const {
    acpCommand,
    apiKey,
    baseURL,
    density,
    executionMode,
    gitAutoCommit,
    handlePresetChange,
    handleSave,
    hasStoredSecret,
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
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Official provider surfaces, runtime orchestration, MCP routing, and gateway
                links now live in one unified control surface. Offisim follows vendor
                compatibility docs first, with Anthropic-compatible transports preferred when
                providers officially support them.
              </p>
            </div>
            {dismissControl}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Official compatibility"
              value={selectedCompatibility}
              detail={`Vendor preset: ${selectedPreset?.label ?? 'Custom'}`}
            />
            <MetricCard label="Surface" value={selectedSurface} detail={`Region: ${selectedRegion}`} />
            <MetricCard
              label="Capabilities"
              value={selectedCapabilities}
              detail="Streaming, tools, thinking, and coding-plan support are preset-aware."
            />
            <MetricCard
              label="Endpoint"
              value={baseURL || selectedPreset?.defaults.baseURL || 'Manual'}
              detail={`Transport owner: ${selectedVendor}`}
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
              <TabsTrigger
                value="openclaw"
                className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-100"
              >
                Gateway
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="provider" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="grid min-h-0 gap-6 xl:grid-cols-[340px,minmax(0,1fr)]">
              <div className="space-y-4">
                <SurfaceCard
                  title="Official compatibility"
                  description="Pick the vendor preset first. Transport, headers, endpoint, and capability hints are derived from the provider's own documentation, not Anthropic or OpenAI marketing copy."
                  icon={<ShieldCheck className="h-5 w-5" />}
                >
                  <div className="rounded-[20px] border border-cyan-400/15 bg-cyan-400/10 px-4 py-4">
                    <p className="text-sm font-semibold text-white">
                      {selectedPreset?.label ?? 'Custom provider'}
                    </p>
                    <p className="mt-2 text-sm text-slate-300">
                      {selectedCompatibility} • {selectedSurface} • {selectedRegion}
                    </p>
                    <p className="mt-3 text-xs leading-5 text-slate-400">{selectedCapabilities}</p>
                  </div>
                </SurfaceCard>

                <SurfaceCard
                  title="Preset notes"
                  description="Anthropic-compatible surfaces are preferred whenever the provider officially supports Claude Code style integration."
                  icon={<Sparkles className="h-5 w-5" />}
                >
                  <div className="space-y-3 text-sm text-slate-300">
                    <p>
                      Offisim stores vendor, region, compatibility surface, and capability matrix
                      alongside the base transport.
                    </p>
                    <p>
                      Custom mode remains available when you need a non-standard endpoint, but
                      presets should be the default path.
                    </p>
                  </div>
                </SurfaceCard>
              </div>

              <div className="space-y-4">
                <SurfaceCard
                  title="Models & Access"
                  description="Configure the active provider surface, credentials, endpoint, and model profile."
                  icon={<Bot className="h-5 w-5" />}
                >
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="lg:col-span-2">
                      <SectionLabel htmlFor="settings-provider">Official vendor preset</SectionLabel>
                      <Select value={preset} onValueChange={handlePresetChange}>
                        <SelectTrigger className={surfaceInputProps()}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(AVAILABLE_PRESETS).map(([key, providerPreset]) => (
                            <SelectItem key={key} value={key}>
                              {providerPreset.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {isSubscription ? (
                      <>
                        <div className="lg:col-span-2 rounded-[20px] border border-blue-400/15 bg-blue-400/10 px-4 py-4">
                          <p className="text-sm font-semibold text-blue-100">Subscription runtime</p>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            Use your local AI subscription runtime without storing an API key.
                            This path is desktop-only and keeps the ACP command explicit.
                          </p>
                        </div>
                        <div className="lg:col-span-2">
                          <SectionLabel htmlFor="settings-acp-command">ACP command</SectionLabel>
                          <Input
                            id="settings-acp-command"
                            value={acpCommand}
                            onChange={(event) => setAcpCommand(event.target.value)}
                            placeholder="claude"
                            className={surfaceInputProps('font-mono')}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="lg:col-span-2">
                        <SectionLabel htmlFor="settings-api-key">Secure API key</SectionLabel>
                        <Input
                          id="settings-api-key"
                          type="password"
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder={
                            hasStoredSecret ? 'Stored securely on this device' : 'sk-ant-...'
                          }
                          className={surfaceInputProps()}
                        />
                        {isTauri() && hasStoredSecret ? (
                          <p className="mt-2 text-xs text-slate-400">
                            Leave this empty to keep the existing secure credential.
                          </p>
                        ) : null}
                      </div>
                    )}

                    {showBaseURL ? (
                      <div className="lg:col-span-2">
                        <SectionLabel htmlFor="settings-base-url">Base URL</SectionLabel>
                        <Input
                          id="settings-base-url"
                          value={baseURL}
                          onChange={(event) => setBaseURL(event.target.value)}
                          placeholder="https://api.example.com/v1"
                          className={surfaceInputProps('font-mono text-sm')}
                        />
                        <p className="mt-2 text-xs text-slate-400">
                          Keep this aligned with the provider's official endpoint surface.
                        </p>
                      </div>
                    ) : null}

                    {!isSubscription ? (
                      <div className="lg:col-span-2">
                        <SectionLabel htmlFor="settings-model">Recommended model</SectionLabel>
                        <Input
                          id="settings-model"
                          value={model}
                          onChange={(event) => {
                            const nextModel = event.target.value;
                            setModel(nextModel);
                            setRuntimeModelDefault((prev) => ({
                              ...prev,
                              provider: selectedPreset?.defaults.provider ?? 'openai-compat',
                              model: nextModel,
                            }));
                          }}
                          placeholder="model-name"
                          className={surfaceInputProps('font-mono text-sm')}
                        />
                      </div>
                    ) : null}
                  </div>

                  {isThinkingProvider ? (
                    <div className="mt-4 rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm leading-6 text-amber-100">
                      Thinking-capable providers burn part of the token budget on reasoning. Keep
                      employee max tokens at 1024 or higher to avoid clipped replies.
                    </div>
                  ) : null}

                  {saveError ? <p className="mt-4 text-sm text-red-400">{saveError}</p> : null}

                  <div className="mt-5 flex justify-end">
                    <Button
                      variant="secondary"
                      onClick={() => void handleSave()}
                      disabled={isSaveDisabled}
                      className="h-11 rounded-2xl border-emerald-400/40 bg-emerald-500/15 px-5 text-emerald-50 hover:border-emerald-300 hover:bg-emerald-500/25"
                    >
                      {isSaving ? 'Saving…' : 'Save provider workspace'}
                    </Button>
                  </div>
                </SurfaceCard>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="runtime" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
              <div className="space-y-4">
                <SurfaceCard
                  title="Runtime orchestration"
                  description="Execution trust, memory retention, summarization, density, and tool search are tuned here without letting the runtime drift away from the active provider preset."
                  icon={<Workflow className="h-5 w-5" />}
                >
                  <div className="space-y-3">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Bound model</p>
                      <p className="mt-2 font-mono text-sm text-cyan-100">
                        {isSubscription ? 'default' : model || 'Unset'}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">{selectedPreset?.label ?? preset}</p>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Persistence</p>
                      <p className="mt-2 text-sm text-slate-300">
                        Runtime policy and provider metadata save through the same pipeline.
                      </p>
                    </div>
                  </div>
                </SurfaceCard>
              </div>

              <div className="space-y-4">
                <SurfaceCard
                  title="Runtime controls"
                  description="Tune orchestration behavior for the local runtime, while keeping the active provider surface pinned."
                  icon={<Cpu className="h-5 w-5" />}
                >
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="lg:col-span-2 rounded-[20px] border border-blue-400/15 bg-blue-400/10 px-4 py-4">
                      <p className="text-sm font-semibold text-blue-100">Default model profile</p>
                      <p className="mt-2 text-sm text-slate-300">
                        Provider:{' '}
                        <span className="font-mono text-cyan-100">
                          {selectedPreset?.label ?? preset}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-slate-300">
                        Model:{' '}
                        <span className="font-mono text-cyan-100">
                          {isSubscription ? 'default' : model || 'Unset'}
                        </span>
                      </p>
                    </div>

                    <div>
                      <SectionLabel htmlFor="settings-execution-mode">Execution mode</SectionLabel>
                      <Select
                        value={executionMode}
                        onValueChange={(value) => setExecutionMode(value as RuntimeExecutionMode)}
                      >
                        <SelectTrigger id="settings-execution-mode" className={surfaceInputProps()}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="desktop-trusted">Desktop trusted</SelectItem>
                          <SelectItem value="browser-limited">Browser limited</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <SectionLabel htmlFor="settings-tool-search">Tool search</SectionLabel>
                      <Select
                        value={toolSearchEnabled ? 'enabled' : 'disabled'}
                        onValueChange={(value) => setToolSearchEnabled(value === 'enabled')}
                      >
                        <SelectTrigger id="settings-tool-search" className={surfaceInputProps()}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">Enabled</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <SectionLabel htmlFor="settings-git-auto-commit">Git auto-commit</SectionLabel>
                      <Select
                        value={gitAutoCommit ? 'enabled' : 'disabled'}
                        onValueChange={(value) => setGitAutoCommit(value === 'enabled')}
                      >
                        <SelectTrigger
                          id="settings-git-auto-commit"
                          className={surfaceInputProps()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">Enabled</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="lg:col-span-2">
                      <SectionLabel htmlFor="settings-density-group">Display density</SectionLabel>
                      <div
                        id="settings-density-group"
                        className="grid gap-2 rounded-[20px] border border-white/10 bg-white/[0.04] p-2 md:grid-cols-3"
                      >
                        {[
                          { value: 'compact', label: 'Compact' },
                          { value: 'normal', label: 'Normal' },
                          { value: 'spacious', label: 'Spacious' },
                        ].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setDensity(option.value as typeof density)}
                            className={`rounded-2xl px-4 py-3 text-sm transition ${
                              density === option.value
                                ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/30'
                                : 'bg-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </SurfaceCard>

                <SurfaceCard
                  title="Summarization"
                  description="Control when long-running conversations compress themselves."
                  icon={<BrainCircuit className="h-5 w-5" />}
                >
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <SectionLabel htmlFor="runtime-summarization-enabled">Enabled</SectionLabel>
                      <Select
                        value={summarizationEnabled ? 'enabled' : 'disabled'}
                        onValueChange={(value) => setSummarizationEnabled(value === 'enabled')}
                      >
                        <SelectTrigger
                          id="runtime-summarization-enabled"
                          className={surfaceInputProps()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">Enabled</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <SectionLabel htmlFor="runtime-summarization-trigger-tokens">
                        Trigger tokens
                      </SectionLabel>
                      <Input
                        id="runtime-summarization-trigger-tokens"
                        type="number"
                        value={summarizationTriggerTokens}
                        onChange={(event) => setSummarizationTriggerTokens(event.target.value)}
                        min={1}
                        className={surfaceInputProps()}
                      />
                    </div>
                    <div>
                      <SectionLabel htmlFor="runtime-summarization-keep-recent">
                        Keep recent
                      </SectionLabel>
                      <Input
                        id="runtime-summarization-keep-recent"
                        type="number"
                        value={summarizationKeepRecentMessages}
                        onChange={(event) => setSummarizationKeepRecentMessages(event.target.value)}
                        min={0}
                        className={surfaceInputProps()}
                      />
                    </div>
                  </div>
                </SurfaceCard>

                <SurfaceCard
                  title="Memory"
                  description="Tune fact retention and memory injection thresholds."
                  icon={<Bot className="h-5 w-5" />}
                >
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <SectionLabel htmlFor="runtime-memory-enabled">Enabled</SectionLabel>
                      <Select
                        value={memoryEnabled ? 'enabled' : 'disabled'}
                        onValueChange={(value) => setMemoryEnabled(value === 'enabled')}
                      >
                        <SelectTrigger id="runtime-memory-enabled" className={surfaceInputProps()}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">Enabled</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <SectionLabel htmlFor="runtime-memory-injection-enabled">
                        Prompt injection
                      </SectionLabel>
                      <Select
                        value={memoryInjectionEnabled ? 'enabled' : 'disabled'}
                        onValueChange={(value) => setMemoryInjectionEnabled(value === 'enabled')}
                      >
                        <SelectTrigger
                          id="runtime-memory-injection-enabled"
                          className={surfaceInputProps()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">Enabled</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <SectionLabel htmlFor="runtime-memory-max-facts">Max facts</SectionLabel>
                      <Input
                        id="runtime-memory-max-facts"
                        type="number"
                        value={memoryMaxFacts}
                        onChange={(event) => setMemoryMaxFacts(event.target.value)}
                        min={1}
                        className={surfaceInputProps()}
                      />
                    </div>
                    <div>
                      <SectionLabel htmlFor="runtime-memory-confidence-threshold">
                        Confidence threshold
                      </SectionLabel>
                      <Input
                        id="runtime-memory-confidence-threshold"
                        type="number"
                        value={memoryConfidenceThreshold}
                        onChange={(event) => setMemoryConfidenceThreshold(event.target.value)}
                        min={0}
                        max={1}
                        step="0.1"
                        className={surfaceInputProps()}
                      />
                    </div>
                  </div>

                  {saveError ? <p className="mt-4 text-sm text-red-400">{saveError}</p> : null}

                  <div className="mt-5 flex justify-end">
                    <Button
                      variant="secondary"
                      onClick={() => void handleSave()}
                      disabled={isSaveDisabled}
                      className="h-11 rounded-2xl border-emerald-400/40 bg-emerald-500/15 px-5 text-emerald-50 hover:border-emerald-300 hover:bg-emerald-500/25"
                    >
                      {isSaving ? 'Saving…' : 'Save runtime orchestration'}
                    </Button>
                  </div>
                </SurfaceCard>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="mcp" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SurfaceCard
              title="MCP servers"
              description="Attach or reconfigure MCP endpoints without leaving the provider workspace."
              icon={<Cpu className="h-5 w-5" />}
            >
              <McpConfigPanel />
            </SurfaceCard>
          </TabsContent>

          <TabsContent value="openclaw" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SurfaceCard
              title="Gateway"
              description="Connect Offisim to OpenClaw or other local orchestration gateways from the same new control surface."
              icon={<Workflow className="h-5 w-5" />}
            >
              <OpenClawSettings />
            </SurfaceCard>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
