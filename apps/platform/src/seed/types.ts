import type {
  AssetKind,
  FilesystemScope,
  NetworkScope,
  PackageManifest,
  RiskClass,
  SupportedEnvironment,
} from '@offisim/asset-schema';

export interface SeedPreview {
  readonly kind: 'hero' | 'screenshot' | 'icon';
  readonly url: string;
  readonly alt_text?: string;
}

/**
 * Raw payload fed into the seeder. Each payload is turned into:
 *   1 × listings row + 1 × package_versions row (with generated .offisimpkg in memory)
 *   ≥1 × listing_previews row
 *
 * `manifest.package.id / kind / version / title` come from the provided
 * `manifest` object directly — the seeder only re-wraps it into the final
 * canonical shape before persistence.
 */
export interface OfficialSeedPayload {
  readonly slug: string;
  readonly kind: AssetKind;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly version: string;
  readonly runtime_range: string;
  readonly schema_version: string;
  readonly risk_class: RiskClass;
  readonly supported_environments: readonly SupportedEnvironment[];
  readonly filesystem_scope: FilesystemScope;
  readonly network_scope: NetworkScope;
  readonly tags: readonly string[];
  readonly previews: readonly SeedPreview[];
  /**
   * Package-scoped identifier used in `manifest.package.id` and
   * `package_versions.package_id`. Must match the schema pattern
   * `^[a-z0-9]+(?:[._-][a-z0-9]+)*$` — no slashes.
   */
  readonly package_id: string;
  /**
   * Role slug advertised by the single primary asset. Becomes
   * `asset.asset_id` (and for employee installs, `employees.role_slug`).
   * Same pattern constraint as `package_id`.
   */
  readonly asset_id: string;
  /**
   * Extra files bundled into the .offisimpkg archive under `assets/…`.
   * Paths must match the schema pattern `^(assets|previews)/…`. Keys are
   * archive-relative paths, values are file bodies (string or bytes).
   */
  readonly assetFiles: Readonly<Record<string, string | Uint8Array>>;
  /**
   * Optional extra `manifest.custom` keys (merged on top of the seeder's
   * defaults — seeder always sets `marketplace_export_kind` and
   * `seed.source = 'offisim-official'`).
   */
  readonly customManifest?: Readonly<Record<string, unknown>>;
}

export interface SeedBuildResult {
  readonly payload: OfficialSeedPayload;
  readonly manifest: PackageManifest;
  readonly zipBytes: Uint8Array;
  readonly packageSha256: string;
  readonly sizeBytes: number;
}
