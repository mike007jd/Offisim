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
} from '@aics/ui-core';
import { useEffect, useState } from 'react';
import {
  clearProviderSecret,
  getProviderSecretStatus,
  setProviderSecret,
} from '../../lib/desktop-provider-secrets';
import { isTauri } from '../../lib/env';
import {
  type ProviderConfig,
  loadProviderConfig,
  saveProviderConfig,
} from '../../lib/provider-config';
import { OpenClawSettings } from '../openclaw/OpenClawSettings';
import { McpConfigPanel } from './McpConfigPanel';
import { PROVIDER_PRESETS } from './provider-presets';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: ProviderConfig) => void;
  /** Optional callback fired after a successful save (e.g. show a toast). */
  onSaveSuccess?: () => void;
}

export function SettingsDialog({ open, onOpenChange, onSave, onSaveSuccess }: SettingsDialogProps) {
  const [preset, setPreset] = useState('gemini');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [defaultHeaders, setDefaultHeaders] = useState('');
  const [acpCommand, setAcpCommand] = useState('claude');
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
        const match = Object.entries(PROVIDER_PRESETS).find(
          ([, p]) => p.defaults.provider === saved.provider && p.defaults.baseURL === saved.baseURL,
        );
        if (match) setPreset(match[0]);
        else setPreset('custom');
      } else {
        // Apply default preset values on first open
        const defaultPreset = PROVIDER_PRESETS.gemini;
        setPreset('gemini');
        setBaseURL(defaultPreset?.defaults.baseURL ?? '');
        setModel(defaultPreset?.defaults.model ?? '');
        setDefaultHeaders('');
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
    }
  }

  const [saveError, setSaveError] = useState('');

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
  const showBaseURL = preset === 'custom' || preset === 'kimi' || preset === 'openrouter';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg h-[520px] flex flex-col">
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
                    {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
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
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="model-name"
                  />
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
