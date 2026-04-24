import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@offisim/ui-core';
import { Bot, Route, ShieldCheck } from 'lucide-react';
import { isTauri } from '../../lib/env';
import { isLlmExecutionLane } from '../../lib/provider-config';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';
import { SectionLabel, SurfaceCard, surfaceInputProps } from './settings-primitives';

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
  const routeSummary = [selectedAccess?.label, selectedCompatibility, selectedSurface, selectedRegion]
    .filter(Boolean)
    .join(' • ');

  return (
    <div className="grid min-h-0 gap-6 xl:grid-cols-[340px,minmax(0,1fr)]">
      <div className="space-y-4">
        <SurfaceCard title="Resolved product" icon={<ShieldCheck className="h-5 w-5" />}>
          <div className="rounded-[20px] border border-cyan-400/15 bg-cyan-400/10 px-4 py-4">
            <p className="text-sm font-semibold text-white">
              {selectedProduct?.displayName ?? 'Manual product'}
            </p>
            <p className="mt-2 text-sm text-slate-300">{routeSummary || 'Select a product'}</p>
            <p className="mt-3 text-xs leading-5 text-slate-400">{selectedCapabilities}</p>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Advanced Routing" icon={<Route className="h-5 w-5" />}>
          <p className="text-sm leading-6 text-slate-300">{routingDescription}</p>
          <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Effective endpoint
            </p>
            <p className="mt-2 break-all font-mono text-sm text-white">
              {effectiveEndpoint || 'Resolved at runtime'}
            </p>
            {selectedVariant?.notes ? (
              <p className="mt-3 text-xs leading-5 text-slate-400">{selectedVariant.notes}</p>
            ) : null}
          </div>
        </SurfaceCard>
      </div>

      <div className="space-y-4">
        <SurfaceCard title="Product & Access" icon={<Bot className="h-5 w-5" />}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2">
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
            </div>

            <div className="lg:col-span-2">
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
              {selectedAccess?.description ? (
                <p className="mt-2 text-xs text-slate-400">{selectedAccess.description}</p>
              ) : null}
            </div>

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
                  <p className="mt-2 text-xs text-slate-400">
                    Leave this empty to keep the existing secure credential.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="lg:col-span-2 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-slate-300">
                This product resolves credentials through the trusted host. No raw secret is stored
                in the webview.
              </div>
            )}
          </div>

          {isThinkingProvider ? (
            <div className="mt-4 rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm text-amber-100">
              Thinking model — keep max tokens at 1024+ to avoid clipped replies.
            </div>
          ) : null}
          {isHostResolvedProduct ? (
            <div className="mt-4 rounded-[20px] border border-cyan-400/20 bg-cyan-400/10 px-4 py-4 text-sm text-cyan-100">
              Local-auth and subscription products fail closed on unsupported hosts. Saving keeps
              the product identity, but runtime binding only activates when a trusted host resolver
              is available.
            </div>
          ) : null}
        </SurfaceCard>

        <SurfaceCard title="Advanced Routing" icon={<Route className="h-5 w-5" />}>
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
                <p className="mt-2 text-xs text-slate-400">
                  Leave empty to use the resolved product default. Products without curated endpoint
                  facts require an explicit override here.
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
              <p className="mt-2 text-xs text-slate-400">
                {verifiedExecutionLanes.length > supportedExecutionLanes.length
                  ? 'Additional lanes exist in provider metadata, but the current runtime host cannot expose them.'
                  : 'The selected product resolves to one active execution binding in this lane.'}
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
              <p className="mt-2 text-xs text-slate-400">
                Optional JSON object merged into the resolved transport headers.
              </p>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
