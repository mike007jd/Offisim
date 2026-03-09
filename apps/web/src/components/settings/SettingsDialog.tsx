import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { type ProviderConfig, loadProviderConfig, saveProviderConfig } from '../../lib/provider-config';
import { PROVIDER_PRESETS } from './provider-presets';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: ProviderConfig) => void;
}

export function SettingsDialog({ open, onOpenChange, onSave }: SettingsDialogProps) {
  const [preset, setPreset] = useState('gemini');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [defaultHeaders, setDefaultHeaders] = useState('');

  useEffect(() => {
    if (open) {
      const saved = loadProviderConfig();
      if (saved) {
        setApiKey(saved.apiKey);
        setBaseURL(saved.baseURL ?? '');
        setModel(saved.model);
        setDefaultHeaders(saved.defaultHeaders ? JSON.stringify(saved.defaultHeaders) : '');
        const match = Object.entries(PROVIDER_PRESETS).find(
          ([, p]) => p.defaults.provider === saved.provider && p.defaults.baseURL === saved.baseURL,
        );
        if (match) setPreset(match[0]);
        else setPreset('custom');
      } else {
        // Apply default preset values on first open
        const defaultPreset = PROVIDER_PRESETS['gemini'];
        setPreset('gemini');
        setBaseURL(defaultPreset?.defaults.baseURL ?? '');
        setModel(defaultPreset?.defaults.model ?? '');
        setDefaultHeaders('');
      }
    }
  }, [open]);

  function handlePresetChange(value: string) {
    setPreset(value);
    const p = PROVIDER_PRESETS[value];
    if (p) {
      setBaseURL(p.defaults.baseURL ?? '');
      setModel(p.defaults.model ?? '');
      setDefaultHeaders(p.defaults.defaultHeaders ? JSON.stringify(p.defaults.defaultHeaders) : '');
    }
  }

  const [saveError, setSaveError] = useState('');

  function handleSave() {
    setSaveError('');
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

    const config: ProviderConfig = {
      provider: p?.defaults.provider ?? 'openai-compat',
      apiKey,
      model,
      ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
      ...(parsedHeaders ? { defaultHeaders: parsedHeaders } : p?.defaults.defaultHeaders ? { defaultHeaders: p.defaults.defaultHeaders } : {}),
    };
    saveProviderConfig(config);
    onSave(config);
    onOpenChange(false);
  }

  const showBaseURL = preset === 'custom' || preset === 'kimi';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>LLM Provider Settings</DialogTitle>
          <DialogDescription>Configure the AI model provider for your company runtime.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label className="text-sm text-text-secondary mb-1 block">Provider</label>
            <Select value={preset} onValueChange={handlePresetChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                  <SelectItem key={key} value={key}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm text-text-secondary mb-1 block">API Key</label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>

          {showBaseURL && (
            <div>
              <label className="text-sm text-text-secondary mb-1 block">Base URL</label>
              <Input
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </div>
          )}

          <div>
            <label className="text-sm text-text-secondary mb-1 block">Model</label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model-name"
            />
          </div>

          {saveError && (
            <p className="text-sm text-red-500">{saveError}</p>
          )}
          <Button onClick={handleSave} disabled={!apiKey || !model}>
            Save Configuration
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
