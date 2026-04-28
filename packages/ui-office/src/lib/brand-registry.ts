/**
 * BrandRegistry — SSOT for supported external-employee brand avatars.
 *
 * Runtime registration is intentionally unsupported; marketplace discovery
 * belongs to Phase 2b #3. Consumers short-circuit on internal employees
 * before any lookup; external employees with null / unknown `brand_key` fall
 * through to the `custom` entry so render paths never throw.
 */

import { CODEX_SVG, CUSTOM_SVG, HERMES_SVG, OPENCLAW_SVG, svgToDataUri } from './brand-svg-sources';

export type BrandVariant = 'default' | 'hermes' | 'openclaw' | 'codex' | 'custom';

export type ExternalBrandVariant = Exclude<BrandVariant, 'default'>;

export interface BrandEntry {
  brandKey: ExternalBrandVariant;
  displayName: string;
  asset2dUri: string;
  asset3dVariant: ExternalBrandVariant;
  accentColor: string;
}

export const HERMES_BRAND: BrandEntry = {
  brandKey: 'hermes',
  displayName: 'Hermes',
  asset2dUri: svgToDataUri(HERMES_SVG),
  asset3dVariant: 'hermes',
  accentColor: '#6366f1',
};

export const OPENCLAW_BRAND: BrandEntry = {
  brandKey: 'openclaw',
  displayName: 'OpenClaw',
  asset2dUri: svgToDataUri(OPENCLAW_SVG),
  asset3dVariant: 'openclaw',
  accentColor: '#dc2626',
};

export const CODEX_BRAND: BrandEntry = {
  brandKey: 'codex',
  displayName: 'Codex',
  asset2dUri: svgToDataUri(CODEX_SVG),
  asset3dVariant: 'codex',
  accentColor: '#0ea5e9',
};

export const CUSTOM_BRAND: BrandEntry = {
  brandKey: 'custom',
  displayName: 'Custom',
  asset2dUri: svgToDataUri(CUSTOM_SVG),
  asset3dVariant: 'custom',
  accentColor: '#a78bfa',
};

export const REGISTRY: Record<ExternalBrandVariant, BrandEntry> = {
  hermes: HERMES_BRAND,
  openclaw: OPENCLAW_BRAND,
  codex: CODEX_BRAND,
  custom: CUSTOM_BRAND,
};

export type BrandResolution = { kind: 'internal' } | { kind: 'external'; entry: BrandEntry };

/**
 * Resolves a brand entry for render-layer branching. Accepts either the
 * DB-shape (`EmployeeRow`) or the runtime-shape (`AgentState`), so callers
 * don't re-encode booleans back into `0 | 1` at the boundary.
 */
export function resolveBrand(
  employee:
    | { is_external: number; brand_key: string | null }
    | { isExternal: boolean; brandKey: string | null },
): BrandResolution {
  const isExternal = 'isExternal' in employee ? employee.isExternal : employee.is_external === 1;
  if (!isExternal) return { kind: 'internal' };
  const key = 'brandKey' in employee ? employee.brandKey : employee.brand_key;
  return { kind: 'external', entry: lookupExternalBrand(key) };
}

/**
 * Always returns a `BrandEntry`; null / unknown keys fall back to
 * `CUSTOM_BRAND`. Use this when the caller already knows the employee is
 * external — skips the internal-branch narrowing of `resolveBrand`.
 */
export function lookupExternalBrand(brandKey: string | null): BrandEntry {
  if (brandKey !== null && brandKey in REGISTRY) {
    return REGISTRY[brandKey as ExternalBrandVariant];
  }
  return CUSTOM_BRAND;
}
