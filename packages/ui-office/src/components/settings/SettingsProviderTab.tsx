import {
  Badge,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@offisim/ui-core';
import { isTauri } from '../../lib/env';
import { isLlmExecutionLane } from '../../lib/provider-config';
import { useTourTarget } from '../onboarding/tour-context.js';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';
import { SectionLabel, SettingsSection, surfaceInputProps } from './settings-primitives';

const IS_DESKTOP = isTauri();
const EXECUTION_LANE_LABELS = {
  gateway: 'Gateway',
  'claude-agent-sdk': 'Claude Agent SDK',
  'codex-agent-sdk': 'Codex App Server',
  'openai-agents-sdk': 'OpenAI Agents SDK',
} as const;

interface SettingsProviderTabProps {
  controller: ReturnType<typeof useSettingsWorkspaceController>;
}

export function SettingsProviderTab({ controller }: SettingsProviderTabProps) {
  const providerTargetRef = useTourTarget('settings:provider-cta');
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

      <div ref={providerTargetRef} className="space-y-6">
        <div className="hidden xl:block">{resolvedSummary}</div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <SectionLabel htmlFor="settings-model">Model</SectionLabel>
            <Input
              id="settings-model"
              value={model}
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
                      <SelectItem
                        key={variant.providerVariantId}
                        value={variant.providerVariantId}
                      >
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
