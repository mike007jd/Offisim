import { useUiState } from '@/app/ui-state.js';
import {
  CapsLabel,
  CardBlock,
  FieldRow,
  Select,
  StatusPill,
} from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import {
  getPreferredProviderId,
  isDesktopProviderBridgeAvailable,
  loadRuntimeProviderProfiles,
  safeErrorMessage,
  selectDefaultChatProvider,
  sendProviderText,
  setPreferredProviderId,
} from '@/lib/provider-bridge.js';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  Key,
  RefreshCw,
} from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
  ACCESS_MODE_OPTIONS,
  PRODUCT_OPTIONS,
  PROVIDER_CONFIGS,
  type ProviderConfig,
  type ProviderFormValues,
  resolveActiveProviderConfig,
  type useProviderConfigs,
} from './settings-data.js';

interface ProviderPaneProps {
  form: UseFormReturn<ProviderFormValues>;
  activeConfigId: string;
  onSelectConfig: (config: ProviderConfig) => void;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  saved: boolean;
  saveError: string | null;
  providerConfigsQuery: ReturnType<typeof useProviderConfigs>;
  onSave: () => void;
  onDiscard: () => void;
}

interface ProviderTestMessage {
  tone: 'ok' | 'warn';
  text: string;
}

function routeProtocolLabel(config: ProviderConfig): string {
  if (config.providerProtocol === 'anthropic') return 'anthropic-compat';
  if (config.providerProtocol === 'openai-compat') return 'openai-compat';
  if (config.providerProtocol === 'openai') return 'openai';
  if (config.endpointKind === 'messages') return 'anthropic-compat';
  return 'openai-compat';
}

function formatRuntimeProfileSyncTime(timestamp: number): string {
  if (!timestamp) return 'Not synced in this session';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function isClaudeLocalAuthConfig(config: ProviderConfig): boolean {
  return config.authMode === 'local-auth' && config.executionLane === 'claude-agent-sdk';
}

function modelOverrideLabel(config: ProviderConfig): string {
  const model = config.model.trim();
  if (model) return model;
  return isClaudeLocalAuthConfig(config) ? 'Account default' : 'Not set';
}

function runtimeProfileSourcesFromConfigs(configs: readonly ProviderConfig[]) {
  return configs.map((config) => ({
    label: config.displayName,
    summary: [
      modelOverrideLabel(config),
      config.hasStoredKey || config.hostResolved ? 'ready' : 'needs key',
    ].join(' · '),
  }));
}

function createProviderTestRequestId(profileId: string): string {
  return `provider-test-${profileId}-${crypto.randomUUID()}`;
}

function resolveEffectiveChatConfigId(
  configs: readonly ProviderConfig[],
  preferredId: string | null,
): string | null {
  return selectDefaultChatProvider(configs, preferredId)?.id ?? null;
}

function providerLogoStyle(config: ProviderConfig): CSSProperties {
  return {
    '--off-provider-brand-a': config.logoGradient[0],
    '--off-provider-brand-b': config.logoGradient[1],
  } as CSSProperties;
}

export function ProviderPane({
  form,
  activeConfigId,
  onSelectConfig,
  dirty,
  valid,
  saving,
  saved,
  saveError,
  providerConfigsQuery,
  onSave,
  onDiscard,
}: ProviderPaneProps) {
  const configs = providerConfigsQuery.data ?? [...PROVIDER_CONFIGS];
  const [revealKey, setRevealKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<ProviderTestMessage | null>(null);
  const [preferredProviderId, setPreferredProviderIdState] = useState<string | null>(() =>
    getPreferredProviderId(),
  );
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const product = form.watch('product');
  const providerBridgeAvailable = isDesktopProviderBridgeAvailable();

  const active = resolveActiveProviderConfig(configs, activeConfigId);
  const isClaudeLocalAuth = isClaudeLocalAuthConfig(active);
  const isManaged = active.accessMode === 'managed';
  const credentialsManagedByHost = isManaged || isClaudeLocalAuth;
  const effectiveChatConfigId = resolveEffectiveChatConfigId(configs, preferredProviderId);
  const inUseForChat = effectiveChatConfigId === active.id;
  const runtimeProfileSources = runtimeProfileSourcesFromConfigs(configs);
  const runtimeProfileRefreshLabel = providerBridgeAvailable
    ? formatRuntimeProfileSyncTime(providerConfigsQuery.dataUpdatedAt)
    : 'Desktop runtime required';
  const runtimeProfileScopeSummary = providerBridgeAvailable
    ? 'Pi Agent runtime profiles'
    : 'Desktop runtime required';
  const runtimeProfileError = providerConfigsQuery.isError
    ? safeErrorMessage(providerConfigsQuery.error)
    : null;

  const endpointBase = active.credentialDestination.replace(/\/$/u, '');
  const effectiveEndpoint = isClaudeLocalAuth
    ? 'Claude Code local account'
    : active.endpointKind === 'messages'
      ? `${endpointBase}/v1/messages`
      : `${endpointBase}/chat/completions`;

  async function handleTestConnection() {
    setIsTesting(true);
    setTestMessage({ tone: 'ok', text: 'Testing desktop provider bridge…' });
    try {
      const profiles = await loadRuntimeProviderProfiles();
      const profile = profiles.find((candidate) => candidate.id === active.id);
      if (!profile) {
        throw new Error('Provider profile is not saved in the desktop runtime.');
      }
      const response = await sendProviderText({
        profile,
        text: 'Reply with exactly: ok',
        requestId: createProviderTestRequestId(active.id),
        maxOutputTokens: 32,
        companyId,
        projectId,
      });
      setTestMessage({
        tone: 'ok',
        text: `${active.displayName} reachable · ${response.slice(0, 80)}`,
      });
      toast.success(`${active.displayName} is reachable`, {
        description: response.slice(0, 120),
      });
    } catch (error) {
      setTestMessage({ tone: 'warn', text: `Test failed · ${safeErrorMessage(error)}` });
      toast.error(`${active.displayName} test failed`, {
        description: safeErrorMessage(error),
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleUseForChat() {
    if (isClaudeLocalAuth) {
      toast.error('Claude Code local account is text-only in Settings', {
        description: 'Main chat still uses stored-key gateway profiles.',
      });
      return;
    }
    if (!active.hasStoredKey) {
      toast.error(`${active.displayName} has no stored key`, {
        description: 'Save an API key for this provider before using it for chat.',
      });
      return;
    }
    setPreferredProviderId(active.id);
    setPreferredProviderIdState(active.id);
    // Evict the cached per-company runtime so the next chat reassembles against
    // the newly-selected provider (the runtime resolves the provider once at
    // assembly time).
    if (companyId) {
      const { disposeDesktopAgentRuntime } = await import('@/runtime/desktop-agent-runtime.js');
      await disposeDesktopAgentRuntime(companyId).catch(() => undefined);
    }
    toast.success(`${active.displayName} is now your chat provider`, {
      description: active.model ? `Model · ${active.model}` : undefined,
    });
  }

  async function handleRefreshRuntimeProfiles() {
    if (!providerBridgeAvailable) {
      toast.error('Runtime profile refresh requires the desktop runtime');
      return;
    }
    try {
      const result = await providerConfigsQuery.refetch();
      if (result.error) throw result.error;
      toast.success('Runtime profiles refreshed', {
        description: `${result.data?.length ?? 0} runtime profiles loaded`,
      });
    } catch (error) {
      toast.error('Runtime profile refresh failed', { description: safeErrorMessage(error) });
    }
  }

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">Pi Agent Runtime</div>
        <div className="off-set-panedesc">Account and transport used by Pi Agent.</div>
      </div>

      {/* Active provider */}
      <section className="off-set-sec">
        <CardBlock>
          <div className="off-set-pv-row">
            <div className="off-set-pv-logo" style={providerLogoStyle(active)}>
              {active.logoMark}
            </div>
            <div className="min-w-0">
              <div className="off-set-pv-name">
                {active.displayName}
                <StatusPill tone={active.hasStoredKey || isClaudeLocalAuth ? 'ok' : 'muted'}>
                  {isClaudeLocalAuth ? 'Local auth' : active.hasStoredKey ? 'Connected' : 'No key'}
                </StatusPill>
                {inUseForChat ? <StatusPill tone="accent">In use for chat</StatusPill> : null}
              </div>
              <div className="off-set-pv-meta">
                {[
                  isClaudeLocalAuth ? 'Claude Code account' : `${active.lane} lane`,
                  active.region,
                  active.endpointKind,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div className="flex items-center gap-[var(--off-sp-3)]">
              {saved ? (
                <span className="inline-flex items-center gap-[var(--off-sp-1)] font-[600] text-[length:var(--off-fs-meta)] text-[color:var(--off-ok)]">
                  <Icon icon={Check} size="sm" />
                  Saved
                </span>
              ) : null}
              {active.hasStoredKey && !inUseForChat ? (
                <Button variant="outline" size="md" onClick={() => void handleUseForChat()}>
                  Use for chat
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="md"
                disabled={isTesting || !providerBridgeAvailable}
                title={
                  providerBridgeAvailable
                    ? 'Send a one-line test request through the desktop provider bridge'
                    : 'Provider connection tests are only available in the desktop runtime'
                }
                onClick={() => void handleTestConnection()}
              >
                <Icon icon={RefreshCw} size="sm" />
                {isTesting ? 'Testing' : 'Test connection'}
              </Button>
            </div>
          </div>
          {testMessage ? (
            <div
              className={`off-set-callout mt-[var(--off-sp-3)] ${
                testMessage.tone === 'warn' ? 'is-warn' : 'is-muted'
              }`}
            >
              <Icon icon={testMessage.tone === 'warn' ? AlertTriangle : Info} size="sm" />
              {testMessage.text}
            </div>
          ) : null}
        </CardBlock>
      </section>

      {/* Credentials — the primary edit */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Credentials</CapsLabel>
        </div>
        <CardBlock>
          {credentialsManagedByHost ? (
            <div className="off-set-callout is-muted">
              <Icon icon={Info} size="sm" />
              {isClaudeLocalAuth
                ? 'Uses the signed-in Claude Code account on this Mac. Offisim stores no API key or OAuth token.'
                : 'Credentials managed by host.'}
            </div>
          ) : (
            <div className="off-field">
              <span className="off-field-label">Secure API key</span>
              <div className="off-set-ctl is-mono">
                <span className="off-set-ctl-lead">
                  <Icon icon={Key} size="sm" />
                </span>
                <Input
                  type={revealKey ? 'text' : 'password'}
                  className="off-set-ctl-input"
                  placeholder="provider token"
                  {...form.register('apiKey')}
                />
                <button
                  type="button"
                  className="off-set-ctl-trail off-focusable"
                  aria-label={revealKey ? 'Hide key' : 'Reveal key'}
                  onClick={() => setRevealKey((v) => !v)}
                >
                  <Icon icon={revealKey ? EyeOff : Eye} size="sm" />
                </button>
              </div>
              <span className="off-field-hint">
                Leave empty to keep the stored key · Saved to <b>{active.credentialDestination}</b>
              </span>
            </div>
          )}
        </CardBlock>
      </section>

      {/* Runtime — primary status, no model catalog on the main path. */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Runtime</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-runtime-grid">
            <div>
              <div className="off-set-cr-t">Kernel</div>
              <div className="off-set-cr-meta">Pi Agent</div>
            </div>
            <div>
              <div className="off-set-cr-t">Connection</div>
              <div className="off-set-cr-meta">
                {isClaudeLocalAuth ? 'Claude Code local account' : routeProtocolLabel(active)}
              </div>
            </div>
            <div>
              <div className="off-set-cr-t">Model override</div>
              <div className="off-set-cr-meta">{modelOverrideLabel(active)}</div>
            </div>
          </div>
        </CardBlock>
      </section>

      {/* Route — resolved summary */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Route</CapsLabel>
        </div>
        <CardBlock>
          <div className="off-set-route-summary">
            <span className="off-set-rs-name">{active.displayName}</span>
            <span className="off-set-route-trail">
              {[
                ACCESS_MODE_OPTIONS.find((o) => o.value === active.accessMode)?.label ??
                  'Global API key',
                routeProtocolLabel(active),
                active.endpointKind,
                active.region,
              ].join(' · ')}
            </span>
          </div>
        </CardBlock>
      </section>

      {/* Configurations — switch the active provider */}
      {configs.length > 1 ? (
        <section className="off-set-sec">
          <div className="off-set-sec-head">
            <CapsLabel>Configurations</CapsLabel>
          </div>
          <CardBlock>
            <FieldRow
              label="Active configuration"
              hint="Switch which provider profile you're editing."
            >
              {({ id }) => (
                <Select
                  id={id}
                  options={configs.map((config) => ({
                    value: config.id,
                    label: config.displayName,
                  }))}
                  value={activeConfigId}
                  onChange={(event) => {
                    const next = configs.find((config) => config.id === event.target.value);
                    if (next) onSelectConfig(next);
                  }}
                />
              )}
            </FieldRow>
          </CardBlock>
        </section>
      ) : null}

      {/* Advanced */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Advanced</CapsLabel>
        </div>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Model override
          </summary>
          <div className="off-set-disclosure-body">
            <FieldRow
              label={
                <>
                  Override model id <span className="off-set-opt">· optional</span>
                </>
              }
              hint={
                form.formState.errors.model?.message ??
                'Leave empty for the account/runtime default.'
              }
              warn={!!form.formState.errors.model}
            >
              {({ id }) => (
                <Input
                  id={id}
                  className="off-mono"
                  placeholder={isClaudeLocalAuth ? 'account default' : active.model || 'model id'}
                  {...form.register('model')}
                />
              )}
            </FieldRow>
          </div>
        </details>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Connection details
          </summary>
          <div className="off-set-disclosure-body">
            <div className="off-set-grid-2">
              <FieldRow label="Product">
                {({ id }) => (
                  <Select
                    id={id}
                    options={PRODUCT_OPTIONS}
                    value={product}
                    {...form.register('product')}
                  />
                )}
              </FieldRow>
              <FieldRow label="Access mode">
                {({ id }) => (
                  <Select
                    id={id}
                    options={ACCESS_MODE_OPTIONS}
                    value={active.accessMode}
                    disabled
                  />
                )}
              </FieldRow>
              <FieldRow
                className="off-set-span-2"
                label={
                  <>
                    Endpoint override <span className="off-set-opt">· optional</span>
                  </>
                }
                hint="Leave empty to use the product default."
              >
                {({ id }) => (
                  <Input
                    id={id}
                    className="off-mono"
                    placeholder={active.credentialDestination}
                    {...form.register('endpointOverride')}
                  />
                )}
              </FieldRow>
              <FieldRow
                className="off-set-span-2"
                label="Effective endpoint"
                hint={`${active.displayName} chat completion endpoint.`}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    className="off-mono"
                    value={effectiveEndpoint}
                    readOnly
                    tabIndex={-1}
                  />
                )}
              </FieldRow>
            </div>
          </div>
        </details>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Runtime profiles
          </summary>
          <div className="off-set-disclosure-body">
            <div className="off-set-catalog-row">
              <div>
                <div className="off-set-cr-t">Runtime profile refresh</div>
                <div className="off-set-cr-meta">
                  Last refresh {runtimeProfileRefreshLabel} · {runtimeProfileScopeSummary}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!providerBridgeAvailable || providerConfigsQuery.isFetching}
                title={
                  providerBridgeAvailable
                    ? 'Refresh desktop runtime provider profiles'
                    : 'Runtime profile refresh is only available in the desktop runtime'
                }
                onClick={() => void handleRefreshRuntimeProfiles()}
              >
                <Icon icon={RefreshCw} size="sm" />
                {providerConfigsQuery.isFetching ? 'Refreshing' : 'Refresh profiles'}
              </Button>
            </div>
            <div className="mb-[var(--off-sp-3)] flex items-center gap-[var(--off-sp-3)]">
              <span className="off-set-chip-mini">Agent scoped</span>
              <span className="text-[length:var(--off-fs-meta)] text-[color:var(--off-ink-3)]">
                {configs.length} runtime profiles available.
              </span>
            </div>
            <div className="off-set-catalog-srcs">
              {runtimeProfileSources.map((src) => (
                <div key={src.label} className="off-set-catalog-src">
                  <div className="off-set-cs-label">{src.label}</div>
                  <div className="off-set-cs-sum">{src.summary}</div>
                </div>
              ))}
            </div>
            {runtimeProfileError ? (
              <div className="off-set-catalog-err">
                <Icon icon={AlertTriangle} size="sm" />
                {runtimeProfileError}
              </div>
            ) : null}
          </div>
        </details>
      </section>

      {/* Dirty-state commit lives in a sticky bar near the edited fields instead
          of the header card, so the header never reflows with form state.
          ⌘S / Escape shortcuts (SettingsSurface) mirror these two actions. */}
      {dirty || saving ? (
        <div className="off-set-savebar">
          {saveError ? (
            <div className="off-set-callout is-warn">
              <Icon icon={AlertTriangle} size="sm" />
              {saveError}
            </div>
          ) : null}
          <Button variant="outline" size="md" disabled={saving} onClick={onDiscard}>
            Discard
          </Button>
          <Button variant="default" size="md" disabled={saving || !valid} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
