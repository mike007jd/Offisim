import type { ModelProfile, RuntimeExecutionMode, RuntimePolicyConfig } from '@offisim/shared-types';
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
import { useEffect, useState } from 'react';
import {
  clearProviderSecret,
  getProviderSecretStatus,
  setProviderSecret,
} from '../../lib/desktop-provider-secrets';
import { isTauri } from '../../lib/env';
import {
  type ProviderConfig,
  createDefaultRuntimePolicy,
  loadProviderConfig,
  normalizeRuntimePolicy,
  saveProviderConfig,
} from '../../lib/provider-config';
import { OpenClawSettings } from '../openclaw/OpenClawSettings';
import { McpConfigPanel } from './McpConfigPanel';
import { PRODUCTION_PRESETS, PROVIDER_PRESETS } from './provider-presets';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: ProviderConfig) => void;
  /** Optional callback fired after a successful save (e.g. show a toast). */
  onSaveSuccess?: () => void;
}

const DEFAULT_POLICY = createDefaultRuntimePolicy('openai-compat', '');

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
  const [preset, setPreset] = useState('gemini');
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
  const [runtimeModelDefault, setRuntimeModelDefault] = useState<ModelProfile>(
    DEFAULT_POLICY.modelPolicy.default,
  );
  const [runtimeModelOverrides, setRuntimeModelOverrides] = useState<
    Record<string, ModelProfile> | undefined
  >(undefined);
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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
        setRuntimeModelDefault(runtimePolicy.modelPolicy.default);
        setRuntimeModelOverrides(runtimePolicy.modelPolicy.overrides);
        const match = Object.entries(PROVIDER_PRESETS).find(
          ([, p]) => p.defaults.provider === saved.provider && p.defaults.baseURL === saved.baseURL,
        );
        if (match) {
          const [matchKey, matchPreset] = match;
          // In production builds, force-migrate legacy vendor-direct configs
          if (!import.meta.env.DEV && matchPreset.devOnly) {
            setPreset('subscription');
            setSaveError(
              `已保存的 provider "${matchPreset.label}" 不再是有效的生产配置，已自动切换为订阅制。请重新保存。`,
            );
          } else {
            setPreset(matchKey);
          }
        } else {
          setPreset(import.meta.env.DEV ? 'custom' : 'subscription');
        }
      } else {
        // Apply default preset values on first open
        const defaultPreset = PROVIDER_PRESETS.subscription;
        setPreset('subscription');
        setBaseURL(defaultPreset?.defaults.baseURL ?? '');
        setModel(defaultPreset?.defaults.model ?? '');
        setDefaultHeaders('');
        const runtimePolicy: RuntimePolicyConfig = createDefaultRuntimePolicy(
          defaultPreset?.defaults.provider ?? 'subscription',
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
        setRuntimeModelDefault(runtimePolicy.modelPolicy.default);
        setRuntimeModelOverrides(runtimePolicy.modelPolicy.overrides);
      }

      if (isTauri()) {
        try {
          const status = await getProviderSecretStatus();
          if (!cancelled) setHasStoredApiKey(status.hasApiKey);
        } catch {
          if (!cancelled) setHasStoredApiKey(false);
        }
      } else {
        setHasStoredApiKey(Boolean(saved?.apiKey));
      }
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
          await clearProviderSecret();
          setHasStoredApiKey(false);
        } else if (apiKey.trim()) {
          await setProviderSecret(apiKey.trim());
          setHasStoredApiKey(true);
        } else if (!hasStoredApiKey) {
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
    preset === 'custom' ||
    preset === 'kimi' ||
    preset === 'openrouter' ||
    preset === 'minimax' ||
    preset === 'deepseek';
  const selectedPreset = PROVIDER_PRESETS[preset];
  const isThinkingProvider = selectedPreset?.hasThinking === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg h-[640px] flex flex-col">
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
                    {Object.entries(
                      import.meta.env.DEV ? PROVIDER_PRESETS : PRODUCTION_PRESETS,
                    ).map(([key, p]) => (
                      <SelectItem key={key} value={key}>
                        {p.label}
                        {p.devOnly ? ' (dev)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isSubscription ? (
                <>
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                    <p className="text-xs text-blue-300 font-medium mb-1">订阅制模式</p>
                    <p className="text-[10px] text-slate-400">
                      使用你本地已安装的 AI 订阅（如 Claude Pro/Max）来运行 agents。 无需 API
                      Key，直接使用订阅额度。
                    </p>
                  </div>
                  <div>
                    <label htmlFor="settings-acp-command" className="text-sm text-shell mb-1 block">
                      CLI 命令
                    </label>
                    <Input
                      id="settings-acp-command"
                      value={acpCommand}
                      onChange={(e) => setAcpCommand(e.target.value)}
                      placeholder="claude"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      ACP server 命令路径。默认 &quot;claude&quot;（Claude Code CLI）。
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
                    placeholder={hasStoredApiKey ? 'Stored securely on this device' : 'sk-...'}
                  />
                  {isTauri() && hasStoredApiKey && (
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
                    {preset === 'openrouter'
                      ? 'OpenRouter endpoint: https://openrouter.ai/api/v1'
                      : preset === 'kimi'
                        ? 'Kimi endpoint: https://api.moonshot.cn/v1'
                        : 'Enter your OpenAI-compatible API endpoint URL'}
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
                  此提供商的模型会返回 thinking 块，消耗 max_tokens 预算。建议员工的 Max
                  Tokens 设置 ≥ 1024，否则 thinking 可能耗尽配额导致回复为空。
                </div>
              )}

              {saveError && <p className="text-sm text-red-500">{saveError}</p>}
              <Button
                onClick={() => void handleSave()}
                disabled={isSaving || !model || (!isSubscription && !apiKey && !hasStoredApiKey)}
              >
                {isSaving ? 'Saving…' : 'Save Configuration'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="runtime" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
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

              <p className="text-[10px] text-slate-500">
                Model selection stays in the provider tab. The runtime policy mirrors that choice as
                the default model profile.
              </p>
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
