import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@offisim/ui-core';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { isTauri } from '../../lib/env';
import { isLlmExecutionLane } from '../../lib/provider-config';
import {
  type ProviderListRefreshSnapshot,
  pullLatestProviderList,
} from '../../lib/provider-list-refresh';
import { useTourTarget } from '../onboarding/tour-context.js';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';
import { SectionLabel, SettingsSection, surfaceInputProps } from './settings-primitives';

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

export function SettingsProviderTab({ controller }: SettingsProviderTabProps) {
  const providerTargetRef = useTourTarget('settings:provider-cta');
  const [providerListPull, setProviderListPull] = useState<ProviderListRefreshSnapshot | null>(
    readStoredProviderListPull,
  );
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

  const apiKeyPlaceholder = hasStoredSecret
    ? 'Stored securely on this device'
    : selectedProduct?.productId === 'lmstudio'
      ? 'lm-studio'
      : selectedProduct?.productId === 'minimax'
        ? 'sk-cp-...'
        : 'sk-...';
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
      : 'This SDK lane is text/reasoning-only in Offisim; file, shell, memory, todo, and skill tools are hidden.';
  const pulledModelOptions = providerListPull?.modelsByProductId[productId] ?? [];
  const modelOptions =
    pulledModelOptions.length > 0 ? pulledModelOptions : (selectedVariant?.modelIds ?? []);
  const providerListPullSummary = providerListPull
    ? providerListPull.sources
        .map((source) => {
          const providerCount =
            typeof source.providerCount === 'number'
              ? `${source.providerCount} tracked providers, `
              : '';
          const modelCount =
            typeof source.modelCount === 'number' ? `${source.modelCount} models` : 'scope only';
          return `${source.label}: ${providerCount}${modelCount}`;
        })
        .join(' • ')
    : 'Hermes Agent / OpenClaw provider scope, with model metadata filled from LiteLLM + OpenRouter';

  async function handleProviderListPull() {
    setIsPullingProviderList(true);
    try {
      const snapshot = await pullLatestProviderList();
      setProviderListPull(snapshot);
      window.localStorage.setItem(PROVIDER_LIST_PULL_STORAGE_KEY, JSON.stringify(snapshot));
      notify?.('Provider list pulled from Hermes Agent and OpenClaw docs.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown provider list error';
      notify?.(`Provider list pull failed: ${message}`, 'error');
    } finally {
      setIsPullingProviderList(false);
    }
  }

  const resolvedSummary = (
    <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
      <span className="font-semibold text-text-primary">
        {selectedProduct?.displayName ?? 'Manual product'}
      </span>
      {selectedAccess?.label ? (
        <Badge className="text-[11px] uppercase tracking-wide">{selectedAccess.label}</Badge>
      ) : null}
      <span className="text-xs text-text-muted">{routeSummary || 'Select a product'}</span>
    </div>
  );

  return (
    <div className="grid min-h-0 gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-3">
        <SectionLabel htmlFor="settings-provider-product">Product</SectionLabel>
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

        <SectionLabel htmlFor="settings-provider-access">Access mode</SectionLabel>
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
        <p className="text-xs text-text-muted" title={selectedCapabilities}>
          {selectedAccess?.description || selectedCapabilities}
        </p>

        <div className="xl:hidden">{resolvedSummary}</div>
      </div>

      <div ref={providerTargetRef} className="space-y-4">
        <div className="hidden xl:block">{resolvedSummary}</div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <SectionLabel htmlFor="settings-model">Model</SectionLabel>
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
              className={surfaceInputProps('font-mono text-sm')}
            />
            {modelOptions.length > 0 ? (
              <datalist id="settings-provider-model-options">
                {modelOptions.map((modelId) => (
                  <option key={modelId} value={modelId} />
                ))}
              </datalist>
            ) : null}
          </div>

          {showApiKeyField ? (
            <div className="lg:col-span-2">
              <SectionLabel htmlFor="settings-api-key">Secure API key</SectionLabel>
              <Input
                id="settings-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={apiKeyPlaceholder}
                className={surfaceInputProps()}
              />
              {IS_DESKTOP && hasStoredSecret ? (
                <p className="mt-2 text-xs text-text-muted">
                  Leave empty to keep the stored credential.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="lg:col-span-2 text-xs text-text-muted">Credentials managed by host.</p>
          )}
        </div>

        {isThinkingProvider ? (
          <p className="text-xs text-warning">Thinking model — keep max tokens at 1024+.</p>
        ) : null}
        {isHostResolvedProduct ? (
          <p className="text-xs text-info">
            Runtime binding activates only when a trusted host resolver is available.
          </p>
        ) : null}

        <SettingsSection
          title="Provider catalog"
          description={providerListPullSummary}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              isLoading={isPullingProviderList}
              onClick={handleProviderListPull}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              拉取 provider list
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <Badge className="text-[11px] uppercase tracking-wide">Agent scoped</Badge>
            <span>
              {providerListPull
                ? `${pulledModelOptions.length} fresh model suggestions for ${selectedProduct?.displayName ?? productId}.`
                : 'Pull refreshes model suggestions without changing saved credentials.'}
            </span>
          </div>
        </SettingsSection>

        <SettingsSection title="Advanced routing" description={routingDescription}>
          <div className="grid gap-4 lg:grid-cols-2">
            {showVariantSelector ? (
              <div className="lg:col-span-2">
                <SectionLabel htmlFor="settings-provider-variant">Provider variant</SectionLabel>
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
              </div>
            ) : null}

            {showEndpointOverride ? (
              <div className="lg:col-span-2">
                <SectionLabel htmlFor="settings-endpoint-override">Endpoint override</SectionLabel>
                <Input
                  id="settings-endpoint-override"
                  value={endpointOverride}
                  onChange={(event) => setEndpointOverride(event.target.value)}
                  placeholder={selectedVariant?.baseURL ?? 'https://api.example.com/v1'}
                  className={surfaceInputProps('font-mono text-sm')}
                />
                <p className="mt-2 text-xs text-text-muted">
                  Leave empty to use the product default.
                </p>
              </div>
            ) : null}

            <div className="lg:col-span-2">
              <SectionLabel htmlFor="settings-execution-lane">Execution lane</SectionLabel>
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
              <p className="mt-2 text-xs text-text-muted">
                {verifiedExecutionLanes.length > supportedExecutionLanes.length
                  ? 'Other lanes exist in metadata but cannot run on this host.'
                  : laneHelp}
              </p>
            </div>

            <div className="lg:col-span-2">
              <SectionLabel htmlFor="settings-default-headers">Default headers</SectionLabel>
              <Textarea
                id="settings-default-headers"
                value={defaultHeaders}
                onChange={(event) => setDefaultHeaders(event.target.value)}
                placeholder='{"HTTP-Referer":"https://example.com"}'
                className={surfaceInputProps('min-h-[120px] font-mono text-sm')}
              />
              <p className="mt-2 text-xs text-text-muted">JSON merged into transport headers.</p>
            </div>

            <div className="lg:col-span-2 text-xs text-text-muted">
              <span className="font-semibold uppercase tracking-wide text-text-secondary">
                Effective endpoint
              </span>
              <p className="mt-1 break-all font-mono text-sm text-text-primary">
                {effectiveEndpoint || 'Resolved at runtime'}
              </p>
              {selectedVariant?.notes ? (
                <p className="mt-2 text-xs text-text-muted">{selectedVariant.notes}</p>
              ) : null}
            </div>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
