import { isTauriRuntime } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { CapsLabel, CardBlock, StatusPill } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { readPiModelOverride, writePiModelOverride } from '@/runtime/pi-agent-config.js';
import {
  Bot,
  CheckCircle2,
  Copy,
  FolderOpen,
  Info,
  RefreshCw,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface PiAgentAuthStatus {
  configured: boolean;
  source?: string;
  label?: string;
}

interface PiAgentAuthAccountStatus {
  provider: string;
  displayName: string;
  auth: PiAgentAuthStatus;
}

interface PiAgentModelSummary {
  provider?: string;
  id?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

interface PiAgentStatusResponse {
  ok: boolean;
  authProviders: string[];
  providerStatus: PiAgentAuthAccountStatus[];
  availableModels: PiAgentModelSummary[];
  allModelCount: number;
  paths?: {
    agentDir?: string;
    authPath?: string;
    modelsPath?: string;
  };
  modelsConfig?: {
    path?: string;
    exists: boolean;
    providerCount: number;
    modelCount: number;
    overrideCount: number;
    providers: string[];
    parseError?: string;
  };
  checkedAt?: string;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}

async function loadPiAgentStatus(): Promise<PiAgentStatusResponse> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<PiAgentStatusResponse>('pi_agent_status');
}

async function openPiConfigFolder(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('pi_agent_open_config_folder');
}

function checkedAtLabel(checkedAt?: string): string {
  if (!checkedAt) return 'Not checked';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(checkedAt));
}

function modelLabel(model: PiAgentModelSummary): string {
  const id = model.id ?? model.name ?? 'model';
  return model.provider ? `${model.provider}/${id}` : id;
}

function copyLabel(text?: string): string {
  if (!text) return 'Unavailable';
  return text.replace(/^\/Users\/[^/]+/u, '~');
}

async function copyText(text: string | undefined, label: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch (err) {
    toast.error(`${label} copy failed`, { description: safeErrorMessage(err) });
  }
}

export function PiAgentPane() {
  const modelOverrideInputId = useId();
  const [status, setStatus] = useState<PiAgentStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOverride, setModelOverride] = useState(() => readPiModelOverride());
  const desktopAvailable = isTauriRuntime();
  const configuredAccounts =
    status?.providerStatus.filter((account) => account.auth.configured) ?? [];
  const ready = configuredAccounts.length > 0 && (status?.availableModels.length ?? 0) > 0;
  const modelsConfig = status?.modelsConfig;
  const paths = status?.paths;
  const modelsConfigState = !status
    ? 'not checked'
    : modelsConfig?.exists
      ? 'present'
      : 'not created';
  const customProviders = modelsConfig?.providers ?? [];
  const shownModels = useMemo(() => status?.availableModels.slice(0, 16) ?? [], [status]);

  const refresh = useCallback(async () => {
    if (!desktopAvailable) {
      setError('Pi Agent status requires the release desktop runtime.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const next = await loadPiAgentStatus();
      setStatus(next);
    } catch (err) {
      const message = safeErrorMessage(err);
      setError(message);
      toast.error('Pi Agent status failed', { description: message });
    } finally {
      setIsLoading(false);
    }
  }, [desktopAvailable]);

  useEffect(() => {
    if (!desktopAvailable) return;
    void refresh();
  }, [desktopAvailable, refresh]);

  function saveModelOverride(next: string) {
    setModelOverride(next);
    writePiModelOverride(next);
  }

  async function handleOpenConfigFolder() {
    try {
      await openPiConfigFolder();
    } catch (err) {
      toast.error('Open Pi config folder failed', { description: safeErrorMessage(err) });
    }
  }

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">Pi Agent</div>
        <div className="off-set-panedesc">The single AI runtime behind chat and work theater.</div>
      </div>

      <section className="off-set-sec">
        <CardBlock>
          <div className="off-set-pv-row">
            <div
              className="off-set-pv-logo"
              style={
                {
                  '--off-provider-brand-a': UI_DATA_COLORS.blue,
                  '--off-provider-brand-b': UI_DATA_COLORS.green,
                } as CSSProperties
              }
            >
              <Icon icon={Bot} size="md" />
            </div>
            <div className="min-w-0">
              <div className="off-set-pv-name">
                Pi Agent Runtime
                <StatusPill tone={ready ? 'ok' : 'muted'}>
                  {ready ? 'Ready' : 'Needs auth'}
                </StatusPill>
              </div>
              <div className="off-set-pv-meta">
                {configuredAccounts.length} authenticated accounts ·{' '}
                {status?.availableModels.length ?? 0} available models · checked{' '}
                {checkedAtLabel(status?.checkedAt)}
              </div>
            </div>
            <Button
              variant="outline"
              size="md"
              disabled={isLoading || !desktopAvailable}
              onClick={() => void refresh()}
            >
              <Icon icon={RefreshCw} size="sm" />
              {isLoading ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
          {error ? (
            <div className="off-set-callout is-warn mt-[var(--off-sp-3)]">
              <Icon icon={TriangleAlert} size="sm" />
              {error}
            </div>
          ) : null}
          {!desktopAvailable ? (
            <div className="off-set-callout is-muted mt-[var(--off-sp-3)]">
              <Icon icon={Info} size="sm" />
              Pi Agent status is available inside the desktop app.
            </div>
          ) : null}
        </CardBlock>
      </section>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Runtime ownership</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-runtime-grid">
            <div>
              <div className="off-set-cr-t">Core</div>
              <div className="off-set-cr-meta">Official Pi Agent SDK</div>
            </div>
            <div>
              <div className="off-set-cr-t">Session storage</div>
              <div className="off-set-cr-meta">Pi SessionManager</div>
            </div>
            <div>
              <div className="off-set-cr-t">Auth and models</div>
              <div className="off-set-cr-meta">Pi AuthStorage / ModelRegistry</div>
            </div>
          </div>
        </CardBlock>
      </section>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Pi auth accounts</CapsLabel>
        </div>
        <CardBlock>
          {configuredAccounts.length > 0 ? (
            <div className="off-set-catalog-srcs">
              {configuredAccounts.map((account) => (
                <div key={account.provider} className="off-set-catalog-src">
                  <div className="off-set-cs-label">
                    <Icon icon={CheckCircle2} size="sm" />
                    {account.displayName}
                  </div>
                  <div className="off-set-cs-sum">
                    {account.provider} · {account.auth.source ?? 'configured'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="off-set-callout is-muted">
              <Icon icon={Info} size="sm" />
              Sign in or add credentials through Pi Agent, then refresh.
            </div>
          )}
        </CardBlock>
      </section>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Pi model configuration</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-pi-config-grid">
            <div className="off-set-catalog-src">
              <div className="off-set-cs-label">
                <Icon icon={SlidersHorizontal} size="sm" />
                models.json
              </div>
              <div className="off-set-cs-sum">
                {copyLabel(modelsConfig?.path ?? paths?.modelsPath)}
              </div>
              <div className="off-set-pi-config-meta">
                <span>{modelsConfigState}</span>
                <span>{modelsConfig?.providerCount ?? 0} custom providers</span>
                <span>{modelsConfig?.modelCount ?? 0} custom models</span>
                <span>{modelsConfig?.overrideCount ?? 0} overrides</span>
              </div>
            </div>
            <div className="off-set-catalog-src">
              <div className="off-set-cs-label">
                <Icon icon={CheckCircle2} size="sm" />
                Pi registry
              </div>
              <div className="off-set-cs-sum">
                {status?.allModelCount ?? 0} total models · {status?.availableModels.length ?? 0}{' '}
                available
              </div>
              <div className="off-set-pi-config-meta">
                {customProviders.slice(0, 4).map((provider) => (
                  <span key={provider}>{provider}</span>
                ))}
                {customProviders.length ? null : <span>built-ins only</span>}
              </div>
            </div>
          </div>
          {modelsConfig?.parseError ? (
            <div className="off-set-callout is-warn mt-[var(--off-sp-3)]">
              <Icon icon={TriangleAlert} size="sm" />
              models.json is present but Pi could not parse it: {modelsConfig.parseError}
            </div>
          ) : null}
          <div className="off-set-pi-actions mt-[var(--off-sp-3)]">
            <Button
              variant="outline"
              size="sm"
              disabled={!desktopAvailable}
              onClick={() => void handleOpenConfigFolder()}
            >
              <Icon icon={FolderOpen} size="sm" />
              Open Pi config folder
            </Button>
            <Button
              variant="subtle"
              size="sm"
              disabled={!modelsConfig?.path && !paths?.modelsPath}
              onClick={() =>
                void copyText(modelsConfig?.path ?? paths?.modelsPath, 'models.json path')
              }
            >
              <Icon icon={Copy} size="sm" />
              Copy models.json path
            </Button>
            <Button
              variant="subtle"
              size="sm"
              disabled={!paths?.authPath}
              onClick={() => void copyText(paths?.authPath, 'auth.json path')}
            >
              <Icon icon={Copy} size="sm" />
              Copy auth.json path
            </Button>
          </div>
          {status && !modelsConfig?.exists ? (
            <div className="off-set-callout is-muted mt-[var(--off-sp-3)]">
              <Icon icon={Info} size="sm" />
              Add custom providers or local models in Pi models.json; built-in models still come
              from Pi Agent.
            </div>
          ) : null}
        </CardBlock>
      </section>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Advanced model override</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-field">
            <label htmlFor={modelOverrideInputId}>Runtime model</label>
            <Input
              id={modelOverrideInputId}
              value={modelOverride}
              placeholder="Pi default"
              spellCheck={false}
              onChange={(event) => saveModelOverride(event.currentTarget.value)}
            />
          </div>
          <div className="off-set-helptext">
            Leave blank to let Pi choose. Use a Pi registry id such as provider/model when a
            specific model should run every chat.
          </div>
          {shownModels.length ? (
            <div className="off-set-pi-models">
              {shownModels.map((model) => {
                const label = modelLabel(model);
                return (
                  <button
                    key={label}
                    type="button"
                    className="off-set-chip-mini off-set-pi-model-chip"
                    onClick={() => saveModelOverride(label)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="off-set-callout is-muted mt-[var(--off-sp-3)]">
              <Icon icon={Info} size="sm" />
              Available models appear here after Pi auth is configured.
            </div>
          )}
          {modelOverride ? (
            <div className="off-set-pi-actions mt-[var(--off-sp-3)]">
              <Button variant="subtle" size="sm" onClick={() => saveModelOverride('')}>
                Clear override
              </Button>
            </div>
          ) : null}
        </CardBlock>
      </section>
    </div>
  );
}
