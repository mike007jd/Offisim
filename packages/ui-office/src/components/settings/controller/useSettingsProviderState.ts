import type {
  LlmExecutionLane,
  ProviderProductAccessMode,
  ProviderProductId,
} from '@offisim/shared-types';
import { useMemo, useState } from 'react';
import { isTauri } from '../../../lib/env';
import type { ProviderConfig } from '../../../lib/provider-config';
import {
  getDefaultProviderAccessMode,
  getDefaultProviderPresetKey,
  getDefaultProviderVariantId,
  getProviderPreset,
  getProviderProductAccess,
  getProviderVariantById,
  getSupportedExecutionLanesForPreset,
} from '../provider-presets';

const IS_DESKTOP = isTauri();
const DEFAULT_PRODUCT_ID = getDefaultProviderPresetKey({ tauri: IS_DESKTOP });

export interface ProviderStateSnapshot {
  productId: ProviderProductId;
  accessMode: ProviderProductAccessMode;
  apiKey: string;
  endpointOverride: string;
  model: string;
  defaultHeaders: string;
  executionLane: LlmExecutionLane;
}

function resolveSelectionMetadata(
  productId: ProviderProductId,
  accessMode?: ProviderProductAccessMode | null,
  providerVariantId?: string | null,
) {
  const product = getProviderPreset(productId);
  const access =
    getProviderProductAccess(product, accessMode) ?? getProviderProductAccess(product, null);
  const resolvedAccessMode = access?.accessMode ?? getDefaultProviderAccessMode(productId);
  const resolvedVariantId =
    providerVariantId && getProviderVariantById(providerVariantId)
      ? providerVariantId
      : (getDefaultProviderVariantId(productId, resolvedAccessMode) ?? '');
  const variant = getProviderVariantById(resolvedVariantId);
  const supportedExecutionLanes = getSupportedExecutionLanesForPreset(
    product,
    resolvedAccessMode,
    resolvedVariantId || null,
  );

  return {
    productId: product?.productId ?? DEFAULT_PRODUCT_ID,
    accessMode: resolvedAccessMode,
    providerVariantId: resolvedVariantId,
    executionLane: supportedExecutionLanes[0] ?? 'gateway',
    supportedExecutionLanes,
    variant,
    defaultApiKey: access?.defaultApiKeyValue ?? '',
  };
}

function resolveSelectionDefaults(
  productId: ProviderProductId,
  accessMode?: ProviderProductAccessMode | null,
  providerVariantId?: string | null,
) {
  const metadata = resolveSelectionMetadata(productId, accessMode, providerVariantId);

  return {
    productId: metadata.productId,
    accessMode: metadata.accessMode,
    providerVariantId: metadata.providerVariantId,
    executionLane: metadata.executionLane,
    supportedExecutionLanes: metadata.supportedExecutionLanes,
    model: metadata.variant?.defaultModel ?? '',
    apiKey: metadata.defaultApiKey,
  };
}

export function useSettingsProviderState() {
  const initialSelection = resolveSelectionDefaults(DEFAULT_PRODUCT_ID);

  const [productId, setProductId] = useState<ProviderProductId>(initialSelection.productId);
  const [accessMode, setAccessMode] = useState<ProviderProductAccessMode>(
    initialSelection.accessMode,
  );
  const [providerVariantId, setProviderVariantId] = useState(initialSelection.providerVariantId);
  const [executionLane, setExecutionLane] = useState<LlmExecutionLane>(
    initialSelection.executionLane,
  );
  const [apiKey, setApiKey] = useState(initialSelection.apiKey);
  const [endpointOverride, setEndpointOverride] = useState('');
  const [model, setModel] = useState(initialSelection.model);
  const [defaultHeaders, setDefaultHeaders] = useState('');
  const [hasStoredSecret, setHasStoredSecret] = useState(false);

  function applySelection(
    nextProductId: ProviderProductId,
    nextAccessMode?: ProviderProductAccessMode | null,
    nextProviderVariantId?: string | null,
  ) {
    const defaults = resolveSelectionDefaults(nextProductId, nextAccessMode, nextProviderVariantId);
    setProductId(defaults.productId);
    setAccessMode(defaults.accessMode);
    setProviderVariantId(defaults.providerVariantId);
    setExecutionLane(defaults.executionLane);
    setModel(defaults.model);
    setEndpointOverride('');
    setDefaultHeaders('');
    setApiKey(defaults.apiKey);
  }

  function handleProductChange(value: string) {
    if (!getProviderPreset(value)) return;
    applySelection(value as ProviderProductId);
    setHasStoredSecret(false);
  }

  function handleAccessModeChange(value: ProviderProductAccessMode) {
    applySelection(productId, value, providerVariantId);
    if (value !== 'api-key') {
      setApiKey('');
      setHasStoredSecret(false);
    }
  }

  function handleVariantChange(value: string) {
    const defaults = resolveSelectionDefaults(productId, accessMode, value);
    setProviderVariantId(defaults.providerVariantId);
    if (!defaults.supportedExecutionLanes.includes(executionLane)) {
      setExecutionLane(defaults.executionLane);
    }
    if (!model || model === getProviderVariantById(providerVariantId)?.defaultModel) {
      setModel(defaults.model);
    }
  }

  function applyFromSaved(saved: ProviderConfig): void {
    const selection = resolveSelectionMetadata(
      saved.productId,
      saved.accessMode,
      saved.providerVariantId,
    );

    setProductId(saved.productId);
    setAccessMode(selection.accessMode);
    setProviderVariantId(selection.providerVariantId);
    setApiKey(saved.apiKey ?? '');
    setEndpointOverride(saved.endpointOverride ?? '');
    setModel(saved.model);
    setExecutionLane(
      selection.supportedExecutionLanes.includes(saved.executionLane)
        ? saved.executionLane
        : selection.executionLane,
    );
    setDefaultHeaders(saved.defaultHeaders ? JSON.stringify(saved.defaultHeaders) : '');
  }

  function applyDefaults(nextProductId: ProviderProductId = DEFAULT_PRODUCT_ID): void {
    applySelection(nextProductId);
    setHasStoredSecret(false);
  }

  const snapshot = useMemo<ProviderStateSnapshot>(
    () => ({
      productId,
      accessMode,
      apiKey,
      endpointOverride,
      model,
      defaultHeaders,
      executionLane,
    }),
    [productId, accessMode, apiKey, endpointOverride, model, defaultHeaders, executionLane],
  );

  return {
    productId,
    accessMode,
    providerVariantId,
    executionLane,
    apiKey,
    endpointOverride,
    model,
    defaultHeaders,
    hasStoredSecret,
    setProductId,
    setAccessMode,
    setProviderVariantId,
    setExecutionLane,
    setApiKey,
    setEndpointOverride,
    setModel,
    setDefaultHeaders,
    setHasStoredSecret,
    handleProductChange,
    handleAccessModeChange,
    handleVariantChange,
    applyFromSaved,
    applyDefaults,
    snapshot,
  };
}

export { DEFAULT_PRODUCT_ID, IS_DESKTOP };
