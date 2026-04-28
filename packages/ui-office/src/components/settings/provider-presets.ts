import type { LlmExecutionLane, ProviderProductId } from '@offisim/shared-types';
import type { ProviderConfig } from '../../lib/provider-config';
import {
  DEFAULT_PROVIDER_PRODUCT_ID,
  PROVIDER_PRODUCTS,
  type ProviderProductDefinition,
  type ProviderVariantDefinition,
  findProviderProductIdByLegacyRoute,
  findProviderProductIdByVariantId,
  getAvailableProviderProducts,
  getDefaultProviderAccessMode,
  getDefaultProviderProductId,
  getDefaultProviderVariantId,
  getProviderProduct,
  getProviderProductAccess,
  getProviderProductOrder,
  getProviderVariant,
  getSupportedExecutionLanesForProduct,
  listProviderVariantsForProduct,
} from '../../lib/provider-product-taxonomy';

export type ProviderPreset = ProviderProductDefinition;
export type ProviderProduct = ProviderProductDefinition;

export const PROVIDER_PRESETS = PROVIDER_PRODUCTS;
export const PROVIDER_PRODUCTS_ORDER = getProviderProductOrder();
export const DEFAULT_PRESET_KEY = DEFAULT_PROVIDER_PRODUCT_ID;

export function getProviderPreset(key: string): ProviderPreset | undefined {
  return getProviderProduct(key);
}

export function getProviderProductById(
  key: ProviderProductId | string | null | undefined,
): ProviderProductDefinition | undefined {
  return getProviderProduct(key);
}

export function getProviderVariantById(
  providerVariantId: string | null | undefined,
): ProviderVariantDefinition | undefined {
  return getProviderVariant(providerVariantId);
}

export function getSupportedExecutionLanesForPreset(
  preset: ProviderPreset | undefined,
  accessMode = preset?.defaultAccessMode,
  providerVariantId?: string | null,
): readonly LlmExecutionLane[] {
  return getSupportedExecutionLanesForProduct(preset, accessMode, providerVariantId);
}

export function findProviderPresetKeyByConfig(
  config: Partial<ProviderConfig> | null,
): string | null {
  if (!config) return null;
  if (config.productId) {
    return getProviderProduct(config.productId)?.productId ?? null;
  }
  if (config.providerVariantId) {
    return findProviderProductIdByVariantId(config.providerVariantId);
  }
  return findProviderProductIdByLegacyRoute({
    provider: config.provider,
    providerVariantId: config.providerVariantId,
    vendor: config.vendor,
    baseURL: config.baseURL,
    compatibility: config.compatibility,
  });
}

export function getAvailableProviderPresets(options: {
  tauri: boolean;
}): Readonly<Record<ProviderProductId, ProviderProductDefinition>> {
  return getAvailableProviderProducts(options);
}

export function getDefaultProviderPresetKey(options: { tauri: boolean }): ProviderProductId {
  return getDefaultProviderProductId(options);
}

export {
  getDefaultProviderAccessMode,
  getDefaultProviderVariantId,
  getProviderProductAccess,
  listProviderVariantsForProduct,
};
