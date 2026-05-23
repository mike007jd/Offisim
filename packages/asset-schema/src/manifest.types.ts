/** Asset package kinds — source: manifest schema */
export type AssetKind =
  | 'employee'
  | 'skill'
  | 'sop'
  | 'company_template'
  | 'office_layout'
  | 'bundle'
  | 'prefab';

export type SupportedEnvironment = 'desktop' | 'docker' | 'web_limited';

export type RiskClass = 'data_asset' | 'logic_asset' | 'privileged_asset';

export type FilesystemScope = 'none' | 'workspace' | 'project' | 'custom_path';

export type NetworkScope = 'none' | 'limited' | 'unrestricted';

export type MirrorPolicy = 'registry_only' | 'external_only' | 'registry_or_external';

export const MATERIALIZER_PAYLOADS_KEY = 'materializer_payloads';

export interface ManifestPackage {
  readonly id: string;
  readonly kind: AssetKind;
  readonly version: string;
  readonly title: string;
  readonly summary?: string;
  readonly license: string;
  readonly publisher?: {
    readonly creator_handle?: string;
    readonly display_name?: string;
  };
  readonly tags?: readonly string[];
}

export interface ManifestCompatibility {
  readonly runtime_range: string;
  readonly schema_version: string;
  readonly supported_environments: readonly SupportedEnvironment[];
  readonly migration_notes?: string;
}

export interface ManifestLineage {
  readonly origin_listing_id?: string;
  readonly origin_package_id?: string;
  readonly forked_from_version?: string;
  readonly derivative_of?: readonly string[];
}

export interface ManifestRecommendedModel {
  readonly profile: string;
  readonly reason?: string;
  readonly provider_hints?: readonly string[];
}

export interface ManifestRequirements {
  readonly required_capabilities: readonly string[];
  readonly required_mcps: readonly string[];
  readonly optional_mcps?: readonly string[];
  readonly recommended_models?: readonly ManifestRecommendedModel[];
}

export interface ManifestPermissions {
  readonly risk_class: RiskClass;
  readonly declares_secrets: boolean;
  readonly secret_slots_required?: readonly string[];
  readonly filesystem_scope: FilesystemScope;
  readonly network_scope: NetworkScope;
  readonly notes?: string;
}

export interface ManifestAsset {
  readonly asset_id: string;
  readonly kind: AssetKind;
  readonly path: string;
  readonly entrypoint?: string;
  readonly default_enabled?: boolean;
  readonly recommended_models?: readonly string[];
}

export interface ManifestDistribution {
  readonly source_url?: string;
  readonly mirror_policy?: MirrorPolicy;
  readonly artifact_size_bytes?: number;
}

export interface ManifestIntegrity {
  readonly package_sha256: string;
  readonly signature?: {
    readonly alg?: string;
    readonly key_id?: string;
    readonly sig?: string;
  };
  readonly files?: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

export interface ManifestPreviews {
  readonly icon_path?: string;
  readonly hero_image_path?: string;
  readonly readme_path?: string;
}

/** Top-level manifest type */
export interface PackageManifest {
  readonly spec_version: string;
  readonly package: ManifestPackage;
  readonly compatibility: ManifestCompatibility;
  readonly lineage?: ManifestLineage;
  readonly requirements: ManifestRequirements;
  readonly permissions: ManifestPermissions;
  readonly assets: readonly ManifestAsset[];
  readonly distribution?: ManifestDistribution;
  readonly integrity: ManifestIntegrity;
  readonly previews?: ManifestPreviews;
  readonly custom?: Readonly<Record<string, unknown>>;
}
