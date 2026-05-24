import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@offisim/ui-core';
import { CheckCircle2, KeyRound, Loader2, RefreshCw, Route } from 'lucide-react';
import { useState } from 'react';
import { isTauri } from '../../lib/env';
import { isLlmExecutionLane } from '../../lib/provider-config';
import {
  type ProviderListRefreshSnapshot,
  pullLatestProviderList,
} from '../../lib/provider-list-refresh';
import { useTourTarget } from '../onboarding/tour-context.js';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';
import {
  SettingsControlGrid,
  SettingsField,
  SettingsFieldNote,
  SettingsNotice,
  SettingsSection,
  surfaceInputProps,
} from './settings-primitives';

const IS_DESKTOP = isTauri();
const PROVIDER_LIST_PULL_STORAGE_KEY = 'offisim-provider-list-last-pull';
const EXECUTION_LANE_LABELS = {
  gateway: 'Gateway',
  'claude-agent-sdk': 'Claude Agent SDK',
  'codex-agent-sdk': 'Codex App Server',
  'openai-agents-sdk': 'OpenAI Agents SDK',
} as const;

interface SettingsProviderTabProps {
  controller: ReturnType<typeof useSettingsWorkspaceController>;
}

function readStoredProviderListPull(): ProviderListRefreshSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROVIDER_LIST_PULL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProviderListRefreshSnapshot>;
    const sourceIds = new Set(parsed.sources?.map((source) => source.sourceId) ?? []);
    if (!sourceIds.has('hermes-agent') || !sourceIds.has('openclaw')) {
      return null;
    }
    return typeof parsed.fetchedAt === 'string' && Array.isArray(parsed.sources)
      ? (parsed as ProviderListRefreshSnapshot)
      : null;
  } catch {
    return null;
  }
}

function formatFetchedAt(fetchedAt: string): string {
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) return fetchedAt;
  return date.toLocaleString();
}

function formatSourceSummary(source: ProviderListRefreshSnapshot['sources'][number]): string {
  const parts: string[] = [];
  if (typeof source.providerCount === 'number') {
    parts.push(`${source.providerCount} providers`);
  }
  if (typeof source.modelCount === 'number') {
    parts.push(`${source.modelCount} models`);
  }
  return parts.length > 0 ? parts.join(' / ') : 'scope source';
}

export function SettingsProviderTab({ controller }: SettingsProviderTabProps) {
  const providerTargetRef = useTourTarget('settings:provider-cta');
  const [providerListPull, setProviderListPull] = useState<ProviderListRefreshSnapshot | null>(
    readStoredProviderListPull,
  );
  const [providerListPullError, setProviderListPullError] = useState<string | null>(null);
  const [isPullingProviderList, setIsPullingProviderList] = useState(false);
  const {
    accessMode,
    apiKey,
    availableAccessModes,
    availableProducts,
    availableProviderVariants,
    defaultHeaders,
    effectiveEndpoint,
    endpointOverride,
    executionLane,
    handleAccessModeChange,
    handleProductChange,
    handleVariantChange,
    hasStoredSecret,
    isHostResolvedProduct,
    isThinkingProvider,
    model,
    notify,
    productId,
    providerVariantId,
    resolvedSelection,
    routingDescription,
    selectedAccess,
    selectedCapabilities,
    selectedCompatibility,
    selectedProduct,
    selectedRegion,
    selectedSurface,
    selectedVariant,
    setApiKey,
    setDefaultHeaders,
    setEndpointOverride,
    setExecutionLane,
    setModel,
    setRuntimeModelDefault,
    showApiKeyField,
    showEndpointOverride,
    showVariantSelector,
    supportedExecutionLanes,
    verifiedExecutionLanes,
  } = controller;

  const apiKeyPlaceholder = (() => {
    if (hasStoredSecret) return 'Stored securely on this device';
    switch (selectedProduct?.productId) {
      case 'lmstudio':
        return 'lm-studio';
      case 'minimax':
        return 'sk-cp-...';
      default:
        return 'sk-...';
    }
  })();
  const routeSummary = [
    selectedAccess?.label,
    selectedCompatibility,
    selectedSurface,
    selectedRegion,
  ]
    .filter(Boolean)
    .join(' • ');
  const laneHelp =
    executionLane === 'gateway'
      ? 'Gateway lane exposes Offisim tools when the active runtime has a trusted host and configured workspace.'
      : 'This SDK-backed transport only calls the model; file, shell, memory, todo, and skill tools require the default harness/gateway path or a verified runtime profile.';
  const credentialDestination = (() => {
    if (!effectiveEndpoint) return 'No endpoint resolved';
    try {
      const endpoint = new URL(effectiveEndpoint);
      return `${endpoint.protocol}//${endpoint.host}`;
    } catch {
      return effectiveEndpoint;
    }
  })();
  const pulledModelOptions = providerListPull?.modelsByProductId[productId] ?? [];
  const modelOptions =
    pulledModelOptions.length > 0 ? pulledModelOptions : (selectedVariant?.modelIds ?? []);
  const providerListPullSummary = providerListPull
    ? `Last refreshed ${formatFetchedAt(providerListPull.fetchedAt)}`
    : 'Hermes Agent / OpenClaw scope, filled with LiteLLM + OpenRouter model metadata';
  const isProviderReady =
    model.trim().length > 0 && (!showApiKeyField || hasStoredSecret || apiKey.trim().length > 0);
  const statusLabel = isProviderReady ? 'Configured' : 'Needs setup';

  async function handleProviderListPull() {
    setIsPullingProviderList(true);
    setProviderListPullError(null);
    try {
      const snapshot = await pullLatestProviderList();
      setProviderListPull(snapshot);
      window.localStorage.setItem(PROVIDER_LIST_PULL_STORAGE_KEY, JSON.stringify(snapshot));
      notify?.('Model catalog refreshed: Hermes Agent / OpenClaw scope.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown provider list error';
      setProviderListPullError(message);
      notify?.(`Model catalog refresh failed: ${message}`, 'error');
    } finally {
      setIsPullingProviderList(false);
    }
  }

  const resolvedSummary = (
    <div className="flex flex-wrap items-center gap-2 text-fs-sm text-ink-3">
      <span className="font-semibold text-ink-1">
        {selectedProduct?.displayName ?? 'Manual product'}
      </span>
      {selectedAccess?.label ? (
        <Badge className="text-fs-meta uppercase tracking-ls-caps">{selectedAccess.label}</Badge>
      ) : null}
      <span className="text-fs-meta text-ink-4">{routeSummary || 'Select a product'}</span>
    </div>
  );

  return (
    <div ref={providerTargetRef} className="flex min-h-0 flex-col gap-sp-4">
      <Card className="rounded-r-md border-line-soft bg-surface-1 shadow-elev-1">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-r-md bg-accent text-accent-fg shadow-elev-1">
              <KeyRound className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-fs-md font-semibold text-ink-1">
                  {selectedVariant?.displayName ?? selectedProduct?.displayName ?? 'Manual'}
                </h3>
                <Badge variant={isProviderReady ? 'success' : 'warning'} size="xs">
                  {statusLabel}
                </Badge>
              </div>
              <p className="mt-1 truncate font-mono text-fs-sm text-ink-3">
                {model || 'No model selected'} · {EXECUTION_LANE_LABELS[executionLane]} ·{' '}
                {selectedRegion}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="outline" size="xs" className="gap-1">
              <Route className="size-3" aria-hidden="true" />
              {selectedCompatibility}
            </Badge>
            <Badge variant="outline" size="xs" className="gap-1">
              <CheckCircle2 className="size-3" aria-hidden="true" />
              {selectedSurface}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <SettingsSection title="Product and access" description={routingDescription}>
        {resolvedSummary}
        <SettingsControlGrid columns={2}>
          <SettingsField id="settings-provider-product" label="Product">
            <Select value={productId} onValueChange={handleProductChange}>
              <SelectTrigger id="settings-provider-product" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(availableProducts).map((product) => (
                  <SelectItem key={product.productId} value={product.productId}>
                    {product.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsField>

          <SettingsField id="settings-provider-access" label="Access mode">
            <Select
              value={accessMode}
              onValueChange={(value) => handleAccessModeChange(value as typeof accessMode)}
            >
              <SelectTrigger id="settings-provider-access" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableAccessModes.map((mode) => (
                  <SelectItem key={mode.accessMode} value={mode.accessMode}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsField>
        </SettingsControlGrid>
        <p className="text-fs-meta text-ink-4" title={selectedCapabilities}>
          {selectedAccess?.description || selectedCapabilities}
        </p>
      </SettingsSection>

      <SettingsSection title="Model and credentials" description={laneHelp}>
        <SettingsField id="settings-model" label="Model">
          <Input
            id="settings-model"
            value={model}
            list={modelOptions.length > 0 ? 'settings-provider-model-options' : undefined}
            onChange={(event) => {
              const nextModel = event.target.value;
              setModel(nextModel);
              setRuntimeModelDefault((prev) => ({
                ...prev,
                provider:
                  resolvedSelection?.provider ?? selectedVariant?.provider ?? 'openai-compat',
                model: nextModel,
              }));
            }}
            placeholder="model-name"
            className={surfaceInputProps('font-mono text-fs-sm')}
          />
          {modelOptions.length > 0 ? (
            <datalist id="settings-provider-model-options">
              {modelOptions.map((modelId) => (
                <option key={modelId} value={modelId} />
              ))}
            </datalist>
          ) : null}
        </SettingsField>

        {showApiKeyField ? (
          <SettingsField id="settings-api-key" label="Secure API key">
            <Input
              id="settings-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={apiKeyPlaceholder}
              className={surfaceInputProps()}
            />
            {IS_DESKTOP && hasStoredSecret ? (
              <SettingsFieldNote>Leave empty to keep the stored credential.</SettingsFieldNote>
            ) : null}
            {IS_DESKTOP ? (
              <SettingsFieldNote>Credential destination: {credentialDestination}</SettingsFieldNote>
            ) : null}
          </SettingsField>
        ) : (
          <p className="text-fs-meta text-ink-4">Credentials managed by host.</p>
        )}

        {isThinkingProvider ? (
          <SettingsNotice tone="warning">Thinking model — keep max tokens at 1024+.</SettingsNotice>
        ) : null}
        {isHostResolvedProduct ? (
          <SettingsNotice>
            Runtime binding activates only when a trusted host resolver is available.
          </SettingsNotice>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Model catalog"
        description={providerListPullSummary}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isPullingProviderList}
            aria-busy={isPullingProviderList || undefined}
            onClick={handleProviderListPull}
          >
            {isPullingProviderList ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Refresh
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-fs-meta text-ink-4">
          <Badge className="text-fs-meta uppercase tracking-ls-caps">Agent scoped</Badge>
          <span>
            {providerListPull
              ? `${pulledModelOptions.length} fresh model suggestions for ${selectedProduct?.displayName ?? productId}.`
              : 'Refresh updates model suggestions without changing saved credentials.'}
          </span>
        </div>
        {providerListPull ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {providerListPull.sources.map((source) => (
              <div
                key={source.sourceId}
                className="rounded-r-sm border border-line bg-surface-1 px-2 py-1.5"
              >
                <p className="font-medium text-ink-3">{source.label}</p>
                <p className="mt-0.5 text-fs-meta text-ink-4">{formatSourceSummary(source)}</p>
              </div>
            ))}
          </div>
        ) : null}
        {providerListPullError ? (
          <SettingsNotice tone="warning">
            Last refresh failed: {providerListPullError}
          </SettingsNotice>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Advanced routing" description={routingDescription}>
        {showVariantSelector ? (
          <SettingsField id="settings-provider-variant" label="Provider variant">
            <Select value={providerVariantId} onValueChange={handleVariantChange}>
              <SelectTrigger id="settings-provider-variant" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableProviderVariants.map((variant) => (
                  <SelectItem key={variant.providerVariantId} value={variant.providerVariantId}>
                    {variant.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsField>
        ) : null}

        {showEndpointOverride ? (
          <SettingsField
            id="settings-endpoint-override"
            label="Endpoint override"
            note="Leave empty to use the product default."
          >
            <Input
              id="settings-endpoint-override"
              value={endpointOverride}
              onChange={(event) => setEndpointOverride(event.target.value)}
              placeholder={selectedVariant?.baseURL ?? 'https://api.example.com/v1'}
              className={surfaceInputProps('font-mono text-fs-sm')}
            />
          </SettingsField>
        ) : null}

        <SettingsField
          id="settings-execution-lane"
          label="Execution lane"
          note={
            verifiedExecutionLanes.length > supportedExecutionLanes.length
              ? 'Other lanes exist in metadata but cannot run on this host.'
              : laneHelp
          }
        >
          <Select
            value={executionLane}
            onValueChange={(value) => {
              if (isLlmExecutionLane(value)) {
                setExecutionLane(value);
              }
            }}
          >
            <SelectTrigger id="settings-execution-lane" className={surfaceInputProps()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supportedExecutionLanes.map((lane) => (
                <SelectItem key={lane} value={lane}>
                  {EXECUTION_LANE_LABELS[lane]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>

        <SettingsField
          id="settings-default-headers"
          label="Default headers"
          note="JSON merged into transport headers."
        >
          <Textarea
            id="settings-default-headers"
            value={defaultHeaders}
            onChange={(event) => setDefaultHeaders(event.target.value)}
            placeholder='{"HTTP-Referer":"https://example.com"}'
            className={surfaceInputProps('min-h-provider-headers font-mono text-fs-sm')}
          />
        </SettingsField>

        <div className="text-fs-meta text-ink-4">
          <span className="font-semibold uppercase tracking-ls-caps text-ink-3">
            Effective endpoint
          </span>
          <p className="mt-1 break-all font-mono text-fs-sm text-ink-1">
            {effectiveEndpoint || 'Resolved at runtime'}
          </p>
          {selectedVariant?.notes ? (
            <p className="mt-2 text-fs-meta text-ink-4">{selectedVariant.notes}</p>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}
