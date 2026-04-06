import type {
  ModelProfile,
  RuntimeExecutionMode,
  RuntimePolicyConfig,
  RuntimeToolPermissionsPolicy,
} from '@offisim/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { useEffect, useMemo, useRef, useState } from 'react';
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
  getAvailableProviderPresets,
  getDefaultProviderPresetKey,
} from './provider-presets';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: ProviderConfig) => void;
  /** Optional callback fired after a successful save (e.g. show a toast). */
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

export function SettingsDialog({ open, onOpenChange, onSave, onSaveSuccess }: SettingsDialogProps) {
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
    open && loadedSnapshotRef.current !== '' && currentSnapshot !== loadedSnapshotRef.current;

  // Capture the first stable snapshot after loadState sets all fields and React re-renders.
  useEffect(() => {
    if (pendingSnapshotCaptureRef.current) {
      loadedSnapshotRef.current = currentSnapshot;
      pendingSnapshotCaptureRef.current = false;
    }
  }, [currentSnapshot]);

  useEffect(() => {
    if (!open) return;

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
        const match = Object.entries(PROVIDER_PRESETS).find(
          ([, p]) => p.defaults.provider === saved.provider && p.defaults.baseURL === saved.baseURL,
        );
        if (match) {
          const [matchKey] = match;
          // subscription is desktop-only (node:child_process). Browser users get MiniMax fallback.
          if (!IS_DESKTOP && matchKey === 'subscription') {
            setPreset(DEFAULT_PRESET_KEY);
            setSaveError(
              'Subscription mode is only available on desktop. Switched to MiniMax — please save again.',
            );
          } else {
            setPreset(matchKey);
          }
        } else {
          setPreset(DEFAULT_PRESET_KEY);
        }
      } else {
        // Apply default preset values on first open
        const defaultPreset = PROVIDER_PRESETS[DEFAULT_PRESET_KEY];
        setPreset(DEFAULT_PRESET_KEY);
        setBaseURL(defaultPreset?.defaults.baseURL ?? '');
        setModel(defaultPreset?.defaults.model ?? '');
        setDefaultHeaders('');
        const runtimePolicy: RuntimePolicyConfig = createDefaultRuntimePolicy(
          defaultPreset?.defaults.provider ?? 'openai-compat',
          defaultPreset?.defaults.model ?? '',
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
      }

      if (IS_DESKTOP) {
        try {
          const status = await getRuntimeSecretStatus();
          if (!cancelled) setHasStoredSecret(status.hasSecret);
        } catch {
          if (!cancelled) setHasStoredSecret(false);
        }
      } else {
        setHasStoredSecret(Boolean(saved?.apiKey));
      }

      pendingSnapshotCaptureRef.current = true;
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handlePresetChange(value: string) {
    setPreset(value);
    const p = PROVIDER_PRESETS[value];
    if (p) {
      setBaseURL(p.defaults.baseURL ?? '');
      setModel(p.defaults.model ?? '');
      setDefaultHeaders(p.defaults.defaultHeaders ? JSON.stringify(p.defaults.defaultHeaders) : '');
      setAcpCommand(p.defaults.acpCommand ?? 'claude');
      setRuntimeModelDefault((prev) => ({
        ...prev,
        provider: p.defaults.provider ?? 'openai-compat',
        model: p.defaults.model ?? '',
      }));
    }
  }

  async function handleSave() {
    setSaveError('');
    try {
      setIsSaving(true);
      const p = PROVIDER_PRESETS[preset];
      const effectiveBaseURL = baseURL || p?.defaults.baseURL;

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
            provider: p?.defaults.provider ?? 'openai-compat',
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
        provider: p?.defaults.provider ?? 'openai-compat',
        apiKey: isSubscription ? '' : apiKey.trim() || undefined,
        model: isSubscription ? 'default' : model,
        ...(effectiveBaseURL && !isSubscription ? { baseURL: effectiveBaseURL } : {}),
        ...(parsedHeaders
          ? { defaultHeaders: parsedHeaders }
          : p?.defaults.defaultHeaders
            ? { defaultHeaders: p.defaults.defaultHeaders }
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
      onOpenChange(false);
      onSaveSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  const isSubscription = preset === 'subscription';
  const showBaseURL =
    preset === 'custom' || PROVIDER_PRESETS[preset]?.defaults.baseURL !== undefined;
  const selectedPreset = PROVIDER_PRESETS[preset];
  const isThinkingProvider = selectedPreset?.hasThinking === true;
  const isSaveDisabled = isSaving || !model || (!isSubscription && !apiKey && !hasStoredSecret);

  const handleRequestClose = () => {
    if (
      hasUnsavedChanges &&
      typeof window !== 'undefined' &&
      !window.confirm('Discard unsaved changes in Settings?')
    ) {
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        handleRequestClose();
      }}
    >
      <DialogContent
        className="max-w-lg max-h-[min(640px,85vh)] h-[640px] flex flex-col overflow-hidden"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          handleRequestClose();
        }}
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your AI model provider and MCP server connections.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="provider" className="mt-2 flex-1 flex flex-col min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="provider" className="flex-1">
              LLM Provider
            </TabsTrigger>
            <TabsTrigger value="runtime" className="flex-1">
              Runtime Policy
            </TabsTrigger>
            <TabsTrigger value="mcp" className="flex-1">
              MCP Servers
            </TabsTrigger>
            <TabsTrigger value="openclaw" className="flex-1">
              OpenClaw
            </TabsTrigger>
          </TabsList>

          <TabsContent value="provider" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
              <div>
                <label htmlFor="settings-provider" className="text-sm text-shell mb-1 block">
                  Provider
                </label>
                <Select value={preset} onValueChange={handlePresetChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(AVAILABLE_PRESETS).map(([key, p]) => (
                      <SelectItem key={key} value={key}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isSubscription ? (
                <>
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                    <p className="text-xs text-blue-300 font-medium mb-1">Subscription Mode</p>
                    <p className="text-[10px] text-slate-400">
                      Use your locally installed AI subscription (e.g. Claude Pro/Max) to run
                      agents. No API Key needed — runs on your subscription quota.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="settings-acp-command" className="text-sm text-shell mb-1 block">
                      CLI Command
                    </label>
                    <Input
                      id="settings-acp-command"
                      value={acpCommand}
                      onChange={(e) => setAcpCommand(e.target.value)}
                      placeholder="claude"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      ACP server command path. Default is &quot;claude&quot; (Claude Code CLI).
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="settings-api-key" className="text-sm text-shell mb-1 block">
                    API Key
                  </label>
                  <Input
                    id="settings-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasStoredSecret ? 'Stored securely on this device' : 'sk-...'}
                  />
                  {isTauri() && hasStoredSecret && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Leave blank to keep the API key already stored securely on this device.
                    </p>
                  )}
                </div>
              )}

              {showBaseURL && (
                <div>
                  <label htmlFor="settings-base-url" className="text-sm text-shell mb-1 block">
                    Base URL
                  </label>
                  <Input
                    id="settings-base-url"
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Enter the endpoint URL for this provider.
                  </p>
                </div>
              )}

              {!isSubscription && (
                <div>
                  <label htmlFor="settings-model" className="text-sm text-shell mb-1 block">
                    Model
                  </label>
                  <Input
                    id="settings-model"
                    value={model}
                    onChange={(e) => {
                      const nextModel = e.target.value;
                      setModel(nextModel);
                      setRuntimeModelDefault((prev) => ({
                        ...prev,
                        provider: selectedPreset?.defaults.provider ?? 'openai-compat',
                        model: nextModel,
                      }));
                    }}
                    placeholder="model-name"
                  />
                </div>
              )}

              {isThinkingProvider && (
                <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
                  This provider returns thinking blocks that consume the max_tokens budget. Set
                  employee Max Tokens to ≥ 1024, or thinking may exhaust the quota and produce empty
                  replies.
                </div>
              )}

              {saveError && <p className="text-sm text-red-500">{saveError}</p>}
              <Button
                variant="secondary"
                onClick={() => void handleSave()}
                disabled={isSaveDisabled}
                className="border-emerald-500/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25 hover:border-emerald-400"
              >
                {isSaving ? 'Saving…' : 'Save Configuration'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="runtime" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                <p className="text-xs font-medium text-shell">Default Model Profile</p>
                <p className="mt-1 text-[11px] text-slate-300">
                  Provider:{' '}
                  <span className="font-mono text-blue-200">{selectedPreset?.label ?? preset}</span>
                </p>
                <p className="text-[11px] text-slate-300">
                  Model:{' '}
                  <span className="font-mono text-blue-200">
                    {isSubscription ? 'default' : model || 'Unset'}
                  </span>
                </p>
                <p className="mt-2 text-[10px] text-slate-500">
                  Runtime policy saves the same provider and model profile configured in the LLM
                  Provider tab.
                </p>
              </div>

              <div className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-3">
                <p className="text-xs font-medium text-shell mb-3">Display Density</p>
                <div className="flex gap-2">
                  {[
                    { value: 'compact', label: 'Compact' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'spacious', label: 'Spacious' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setDensity(option.value as typeof density)}
                      className={`rounded-md border px-3 py-2 text-xs transition ${
                        density === option.value
                          ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                          : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  Controls spacing density across the shell and studio panels.
                </p>
              </div>

              <div>
                <label htmlFor="settings-execution-mode" className="text-sm text-shell mb-1 block">
                  Execution Mode
                </label>
                <Select
                  value={executionMode}
                  onValueChange={(value) => setExecutionMode(value as RuntimeExecutionMode)}
                >
                  <SelectTrigger id="settings-execution-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="desktop-trusted">Desktop trusted</SelectItem>
                    <SelectItem value="browser-limited">Browser limited</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Controls the trust boundary used by the local runtime.
                </p>
              </div>

              <div className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-3">
                <p className="text-xs font-medium text-shell mb-3">Summarization</p>
                <div className="grid gap-3">
                  <div>
                    <label
                      htmlFor="runtime-summarization-enabled"
                      className="text-[10px] text-slate-400 mb-1 block"
                    >
                      Enabled
                    </label>
                    <Select
                      value={summarizationEnabled ? 'enabled' : 'disabled'}
                      onValueChange={(value) => setSummarizationEnabled(value === 'enabled')}
                    >
                      <SelectTrigger id="runtime-summarization-enabled">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label
                      htmlFor="runtime-summarization-trigger-tokens"
                      className="text-[10px] text-slate-400 mb-1 block"
                    >
                      Trigger tokens
                    </label>
                    <Input
                      id="runtime-summarization-trigger-tokens"
                      type="number"
                      value={summarizationTriggerTokens}
                      onChange={(e) => setSummarizationTriggerTokens(e.target.value)}
                      min={1}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="runtime-summarization-keep-recent"
                      className="text-[10px] text-slate-400 mb-1 block"
                    >
                      Keep recent messages
                    </label>
                    <Input
                      id="runtime-summarization-keep-recent"
                      type="number"
                      value={summarizationKeepRecentMessages}
                      onChange={(e) => setSummarizationKeepRecentMessages(e.target.value)}
                      min={0}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-3">
                <p className="text-xs font-medium text-shell mb-3">Memory</p>
                <div className="grid gap-3">
                  <div>
                    <label
                      htmlFor="runtime-memory-enabled"
                      className="text-[10px] text-slate-400 mb-1 block"
                    >
                      Enabled
                    </label>
                    <Select
                      value={memoryEnabled ? 'enabled' : 'disabled'}
                      onValueChange={(value) => setMemoryEnabled(value === 'enabled')}
                    >
                      <SelectTrigger id="runtime-memory-enabled">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label
                      htmlFor="runtime-memory-injection-enabled"
                      className="text-[10px] text-slate-400 mb-1 block"
                    >
                      Prompt injection
                    </label>
                    <Select
                      value={memoryInjectionEnabled ? 'enabled' : 'disabled'}
                      onValueChange={(value) => setMemoryInjectionEnabled(value === 'enabled')}
                    >
                      <SelectTrigger id="runtime-memory-injection-enabled">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label
                      htmlFor="runtime-memory-max-facts"
                      className="text-[10px] text-slate-400 mb-1 block"
                    >
                      Max facts
                    </label>
                    <Input
                      id="runtime-memory-max-facts"
                      type="number"
                      value={memoryMaxFacts}
                      onChange={(e) => setMemoryMaxFacts(e.target.value)}
                      min={1}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="runtime-memory-confidence-threshold"
                      className="text-[10px] text-slate-400 mb-1 block"
                    >
                      Confidence threshold
                    </label>
                    <Input
                      id="runtime-memory-confidence-threshold"
                      type="number"
                      value={memoryConfidenceThreshold}
                      onChange={(e) => setMemoryConfidenceThreshold(e.target.value)}
                      min={0}
                      max={1}
                      step="0.1"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="settings-tool-search" className="text-sm text-shell mb-1 block">
                  Tool Search
                </label>
                <Select
                  value={toolSearchEnabled ? 'enabled' : 'disabled'}
                  onValueChange={(value) => setToolSearchEnabled(value === 'enabled')}
                >
                  <SelectTrigger id="settings-tool-search">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Large tool sets can be discovered lazily instead of injected upfront.
                </p>
              </div>

              <div>
                <label htmlFor="settings-git-auto-commit" className="text-sm text-shell mb-1 block">
                  Git Auto-Commit
                </label>
                <Select
                  value={gitAutoCommit ? 'enabled' : 'disabled'}
                  onValueChange={(value) => setGitAutoCommit(value === 'enabled')}
                >
                  <SelectTrigger id="settings-git-auto-commit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Automatically commit file changes after each plan step (desktop only).
                </p>
              </div>

              <p className="text-[10px] text-slate-500">
                Changes here persist through the same save pipeline as provider settings, so the
                runtime policy and LLM provider cannot drift.
              </p>

              {saveError && <p className="text-sm text-red-500">{saveError}</p>}
              <Button
                variant="secondary"
                onClick={() => void handleSave()}
                disabled={isSaveDisabled}
                className="border-emerald-500/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25 hover:border-emerald-400"
              >
                {isSaving ? 'Saving…' : 'Save Runtime Policy'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="mcp" className="flex-1 overflow-y-auto min-h-0">
            <div className="pt-2">
              <McpConfigPanel />
            </div>
          </TabsContent>

          <TabsContent value="openclaw" className="flex-1 overflow-y-auto min-h-0">
            <div className="pt-2">
              <OpenClawSettings />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
