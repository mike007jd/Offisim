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
import { Textarea } from '@/design-system/primitives/textarea.js';
import {
  isDesktopProviderBridgeAvailable,
  loadRuntimeProviderProfiles,
  safeErrorMessage,
  sendProviderText,
} from '@/lib/provider-bridge.js';
import { AlertTriangle, ChevronRight, Eye, EyeOff, Info, Key, RefreshCw } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
  ACCESS_MODE_OPTIONS,
  EXECUTION_LANE_OPTIONS,
  PRODUCT_OPTIONS,
  PROVIDER_CONFIGS,
  PROVIDER_VARIANT_OPTIONS,
  type ProviderConfig,
  type ProviderFormValues,
  resolveActiveProviderConfig,
  useProviderConfigs,
} from './settings-data.js';

interface ProviderPaneProps {
  form: UseFormReturn<ProviderFormValues>;
  activeConfigId: string;
  onSelectConfig: (config: ProviderConfig) => void;
}

function runtimeProfileMatches(config: ProviderConfig, displayName: string): boolean {
  const normalizedName = displayName.toLowerCase();
  if (config.product === 'minimax') return normalizedName.includes('minimax');
  return normalizedName.includes(config.displayName.toLowerCase());
}

function routeProtocolLabel(config: ProviderConfig): string {
  if (config.product === 'minimax' || config.product === 'anthropic') return 'anthropic-compat';
  if (config.product === 'openai') return 'openai';
  return 'openai-compat';
}

function formatCatalogSyncTime(timestamp: number): string {
  if (!timestamp) return 'Not synced in this session';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function modelSuggestionsFromConfigs(configs: readonly ProviderConfig[]): string[] {
  return [...new Set(configs.map((config) => config.model).filter(Boolean))];
}

function catalogSourcesFromConfigs(configs: readonly ProviderConfig[]) {
  return configs.map((config) => ({
    label: config.displayName,
    summary: `${config.model} · ${config.hasStoredKey || config.hostResolved ? 'ready' : 'needs key'}`,
  }));
}

function createProviderTestRequestId(profileId: string): string {
  return `provider-test-${profileId}-${crypto.randomUUID()}`;
}

function providerLogoStyle(config: ProviderConfig): CSSProperties {
  return {
    '--off-provider-brand-a': config.logoGradient[0],
    '--off-provider-brand-b': config.logoGradient[1],
  } as CSSProperties;
}

export function ProviderPane({ form, activeConfigId, onSelectConfig }: ProviderPaneProps) {
  const providerConfigsQuery = useProviderConfigs();
  const configs = providerConfigsQuery.data ?? [...PROVIDER_CONFIGS];
  const [revealKey, setRevealKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const product = form.watch('product');
  const accessMode = form.watch('accessMode');
  const providerVariant = form.watch('variant');
  const executionLane = form.watch('lane');
  const isManaged = accessMode === 'managed';
  const isHostResolved = accessMode === 'host-resolved' || accessMode === 'managed';
  const providerBridgeAvailable = isDesktopProviderBridgeAvailable();

  const active = resolveActiveProviderConfig(configs, activeConfigId);
  const activeConfig = active;
  const modelSuggestions = useMemo(() => modelSuggestionsFromConfigs(configs), [configs]);
  const catalogSources = useMemo(() => catalogSourcesFromConfigs(configs), [configs]);
  const runtimeProfileRefreshLabel = providerBridgeAvailable
    ? formatCatalogSyncTime(providerConfigsQuery.dataUpdatedAt)
    : 'Desktop runtime required';
  const runtimeProfileScopeSummary = providerBridgeAvailable
    ? 'Desktop runtime profiles only'
    : 'Browser preview uses curated fallback rows only';
  const catalogError = providerConfigsQuery.isError
    ? safeErrorMessage(providerConfigsQuery.error)
    : null;

  const effectiveEndpoint =
    activeConfig.endpointKind === 'messages'
      ? `${activeConfig.credentialDestination.replace(/\/$/u, '')}/v1/messages`
      : `${activeConfig.credentialDestination.replace(/\/$/u, '')}/v1/chat/completions`;

  async function handleTestConnection() {
    setIsTesting(true);
    setTestMessage('Testing desktop provider bridge...');
    try {
      const profiles = await loadRuntimeProviderProfiles();
      const profile =
        profiles.find((candidate) => candidate.id === activeConfig.id) ??
        profiles.find((candidate) => runtimeProfileMatches(activeConfig, candidate.displayName));
      if (!profile) {
        throw new Error('Provider profile is not saved in the desktop runtime.');
      }
      const response = await sendProviderText({
        profile,
        text: 'Reply with exactly: ok',
        requestId: createProviderTestRequestId(activeConfig.id),
        maxOutputTokens: 32,
      });
      setTestMessage(`${activeConfig.displayName} reachable · ${response.slice(0, 80)}`);
      toast.success(`${activeConfig.displayName} is reachable`, {
        description: response.slice(0, 120),
      });
    } catch (error) {
      setTestMessage(`Test failed · ${safeErrorMessage(error)}`);
      toast.error(`${activeConfig.displayName} test failed`, {
        description: safeErrorMessage(error),
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleRefreshCatalog() {
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
        <div className="off-set-panetitle">Provider</div>
        <div className="off-set-panedesc">The AI provider your employees use.</div>
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
                <StatusPill tone={active.hasStoredKey ? 'ok' : 'muted'}>
                  {active.hasStoredKey ? 'Connected' : 'No key'}
                </StatusPill>
              </div>
              <div className="off-set-pv-meta">
                {active.model} · {active.lane} lane · {active.region} · {active.endpointKind}
              </div>
            </div>
            <Button
              variant="outline"
              size="md"
              disabled={isTesting}
              onClick={() => void handleTestConnection()}
            >
              <Icon icon={RefreshCw} size="sm" />
              {isTesting ? 'Testing' : 'Test connection'}
            </Button>
          </div>
          {testMessage ? (
            <div className="off-set-sec-hint mt-[var(--off-sp-3)]">{testMessage}</div>
          ) : null}
        </CardBlock>
      </section>

      {/* Credentials — the primary edit */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Credentials</CapsLabel>
        </div>
        <CardBlock>
          {isManaged ? (
            <div className="off-set-callout is-muted">
              <Icon icon={Info} size="sm" />
              Credentials managed by host.
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
          <div className="mt-[var(--off-sp-4)] flex flex-col gap-[var(--off-sp-2)]">
            {active.isThinking ? (
              <div className="off-set-callout is-warn">
                <Icon icon={AlertTriangle} size="sm" />
                Thinking model — keep max tokens at 1024+.
              </div>
            ) : null}
            {isHostResolved ? (
              <div className="off-set-callout is-info">
                <Icon icon={Info} size="sm" />
                Local/host-managed providers need a running host.
              </div>
            ) : null}
          </div>
        </CardBlock>
      </section>

      {/* Model — the primary edit */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Model</CapsLabel>
        </div>
        <CardBlock>
          <FieldRow
            label="Model"
            hint={
              form.formState.errors.model?.message ??
              'Type any model id; suggestions come from your provider profiles.'
            }
            warn={!!form.formState.errors.model}
          >
            {({ id }) => (
              <>
                <Input
                  id={id}
                  className="off-mono"
                  placeholder="model-name"
                  {...form.register('model')}
                />
                {modelSuggestions.length > 0 ? (
                  <div className="off-set-model-suggestions" aria-label="Model suggestions">
                    {modelSuggestions.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className="off-set-model-chip off-focusable"
                        onClick={() =>
                          form.setValue('model', model, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          })
                        }
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </FieldRow>
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
            <span className="off-set-chip-mini">
              {ACCESS_MODE_OPTIONS.find((o) => o.value === accessMode)?.label ?? 'Global API key'}
            </span>
            <span className="off-set-route-trail">
              {routeProtocolLabel(activeConfig)} · {activeConfig.endpointKind} ·{' '}
              {activeConfig.region}
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
                    label: `${config.displayName} · ${config.model}`,
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
            Connection details
          </summary>
          <div className="off-set-disclosure-body">
            <p className="off-set-sec-hint mb-[var(--off-sp-4)] mt-0">
              How {active.displayName} is reached. Product and access mode follow the configuration
              you pick above; override them only for a custom transport.
            </p>
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
                    value={accessMode}
                    {...form.register('accessMode')}
                  />
                )}
              </FieldRow>
              <FieldRow label="Provider variant">
                {({ id }) => (
                  <Select
                    id={id}
                    options={PROVIDER_VARIANT_OPTIONS}
                    value={providerVariant}
                    {...form.register('variant')}
                  />
                )}
              </FieldRow>
              <FieldRow
                label="Execution lane"
                hint="Gateway exposes Offisim tools. SDK lanes are transport only."
              >
                {({ id }) => (
                  <Select
                    id={id}
                    options={EXECUTION_LANE_OPTIONS}
                    value={executionLane}
                    {...form.register('lane')}
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
                    placeholder={`${active.credentialDestination}/v1`}
                    {...form.register('endpointOverride')}
                  />
                )}
              </FieldRow>
              <FieldRow
                className="off-set-span-2"
                label={
                  <>
                    Default headers <span className="off-set-opt">· JSON</span>
                  </>
                }
                hint="JSON merged into transport headers."
              >
                {({ id }) => (
                  <Textarea
                    id={id}
                    className="off-mono"
                    placeholder='{"HTTP-Referer":"https://example.com"}'
                    {...form.register('headersJson')}
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
            Runtime profile models
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
                    ? 'Refresh model suggestions from desktop runtime provider profiles'
                    : 'Runtime profile refresh is only available in the desktop runtime'
                }
                onClick={() => void handleRefreshCatalog()}
              >
                <Icon icon={RefreshCw} size="sm" />
                {providerConfigsQuery.isFetching ? 'Refreshing' : 'Refresh profiles'}
              </Button>
            </div>
            <div className="mb-[var(--off-sp-3)] flex items-center gap-[var(--off-sp-3)]">
              <span className="off-set-chip-mini">Agent scoped</span>
              <span className="text-[length:var(--off-fs-meta)] text-[color:var(--off-ink-3)]">
                {modelSuggestions.length} model suggestions from the active provider profiles.
              </span>
            </div>
            <div className="off-set-catalog-srcs">
              {catalogSources.map((src) => (
                <div key={src.label} className="off-set-catalog-src">
                  <div className="off-set-cs-label">{src.label}</div>
                  <div className="off-set-cs-sum">{src.summary}</div>
                </div>
              ))}
            </div>
            {catalogError ? (
              <div className="off-set-catalog-err">
                <Icon icon={AlertTriangle} size="sm" />
                {catalogError}
              </div>
            ) : null}
          </div>
        </details>
      </section>
    </div>
  );
}
