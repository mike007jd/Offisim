// Types derived from offisim_openapi.yaml schemas

import type { AssetKind, RiskClass, SupportedEnvironment } from '@offisim/asset-schema';

// ── Search ──

export interface SearchParams {
  q?: string;
  kind?: AssetKind;
  risk_class?: RiskClass;
  tag?: string;
  sort?: 'relevance' | 'newest' | 'updated' | 'rating' | 'installs';
  page?: number;
  per_page?: number;
}

export interface SearchResponse {
  items: ListingSummary[];
  page: number;
  per_page: number;
  total: number;
}

// ── Listing ──

export interface CreatorSummary {
  creator_id: string;
  handle: string;
  display_name: string;
  verification_state: 'unverified' | 'verified' | 'trusted';
}

export interface PreviewRef {
  kind: 'icon' | 'image' | 'video' | 'readme';
  url: string;
  alt?: string;
}

export interface ListingSummary {
  listing_id: string;
  slug: string;
  kind: AssetKind;
  title: string;
  summary: string;
  creator: CreatorSummary;
  status: 'listed' | 'hidden' | 'retired';
  /** Stable manifest package identifier — survives catalog re-seed. */
  package_id?: string;
  latest_version: string;
  rating: number;
  install_count: number;
  tags?: string[];
  preview?: PreviewRef;
}

export interface VersionSummary {
  package_id: string;
  package_version_id?: string;
  version: string;
  runtime_range: string;
  schema_version: string;
  environments: SupportedEnvironment[];
  risk_class: RiskClass;
  published_at?: string;
  changelog?: string;
}

export interface RequirementsSummary {
  required_capabilities?: string[];
  required_mcps?: string[];
  recommended_models?: RecommendedModel[];
}

export interface RecommendedModel {
  profile: string;
  reason?: string;
  provider_hints?: string[];
}

export interface PermissionSummary {
  risk_class?: RiskClass;
  declares_secrets?: boolean;
  filesystem_scope?: 'none' | 'workspace' | 'project' | 'custom_path';
  network_scope?: 'none' | 'limited' | 'unrestricted';
}

export interface LineageSummary {
  origin_package_id?: string;
  forked_from_version?: string;
  derivative_of?: string[];
}

export interface ListingDetail extends ListingSummary {
  description: string;
  version: VersionSummary;
  requirements: RequirementsSummary;
  permissions: PermissionSummary;
  lineage?: LineageSummary;
  previews?: PreviewRef[];
}

// ── Versions ──

export interface VersionListResponse {
  listing_id: string;
  versions: VersionSummary[];
}

// ── Reviews ──

export interface Review {
  review_id: string;
  listing_id: string;
  user_id?: string;
  rating: number;
  title?: string;
  body?: string;
  moderation_state: 'visible' | 'hidden' | 'flagged';
  created_at: string;
  updated_at: string;
}

export interface ReviewListResponse {
  listing_id: string;
  reviews: Review[];
}

export interface CreateReviewRequest {
  listing_id: string;
  rating: number;
  title?: string;
  body?: string;
}

// ── Publish ──

export interface PublishDraft {
  draft_id: string;
  creator_id: string;
  listing_id?: string | null;
  artifact_id?: string | null;
  kind?: string;
  title?: string | null;
  summary?: string | null;
  manifest_json?: Record<string, unknown>;
  validation_state: 'unknown' | 'valid' | 'invalid';
  validation_report?: Record<string, unknown>;
  status: 'draft' | 'validated' | 'submitted' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface ListDraftsParams {
  status?: PublishDraft['status'];
}

export interface ListDraftsResponse {
  drafts: PublishDraft[];
}

export interface MyCreatorProfile {
  creator_id: string;
  handle: string;
  display_name: string;
  bio?: string | null;
  website_url?: string | null;
  verification_state: 'unverified' | 'verified' | 'trusted';
  created_at: string;
}

export interface MyCreatorResponse {
  creator: MyCreatorProfile | null;
}

export interface CreateDraftRequest {
  kind: AssetKind;
  listing_id?: string | null;
  title: string;
  summary?: string;
  artifact_upload_mode?: 'registry_object' | 'external_url';
}

export interface PutDraftManifestRequest {
  manifest_json: Record<string, unknown>;
  artifact?: {
    storage_backend?: 'registry_object' | 'external_url' | 'github_release' | 'npm';
    external_url?: string;
    sha256?: string;
    size_bytes?: number;
  };
}

export interface PublishSubmitRequest {
  draft_id: string;
  submit_message?: string;
}

export interface SubmitResponse {
  draft_id: string;
  moderation_job_id: string;
  status: 'queued' | 'pending_review';
}

// ── Library ──

export interface LibraryItem {
  listing: ListingSummary;
  version: VersionSummary;
  saved_at: string;
  install_receipt_id?: string | null;
}

export interface LibraryParams {
  kind?: AssetKind;
  installed?: boolean;
}

export interface LibraryResponse {
  items: LibraryItem[];
}

// ── Install ──

export interface InstallReceiptRequest {
  listing_id: string;
  package_version_id: string;
  install_source: 'registry' | 'url' | 'file';
}

export interface InstallReceiptResponse {
  install_receipt_id: string;
  listing_id: string;
  package_version_id: string;
}

export interface ArtifactDownloadInfo {
  package_version_id: string;
  artifact_url: string;
  artifact_sha256: string | null;
  artifact_size_bytes: number | null;
}

// ── Fork / Lineage ──

export interface ForkSummary {
  listingId: string;
  title: string;
  slug: string;
  creatorHandle: string;
  version: string;
  forkedAt: string;
}

export interface ForksResponse {
  forks: ForkSummary[];
}

export interface LineageNode {
  listingId: string;
  title: string;
  slug: string;
  version: string;
}

export interface LineageResponse {
  ancestors: LineageNode[];
  descendants: LineageNode[];
}

// ── Report ──

export interface CreateReportRequest {
  reason: 'spam' | 'malicious_code' | 'copyright' | 'misleading' | 'other';
  details?: string;
}

export interface ReportResponse {
  flag_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: string;
}

// ── Creator Profile (extension beyond OpenAPI — needed for market pages) ──

export interface CreatorProfile extends CreatorSummary {
  bio?: string;
  website_url?: string;
  created_at: string;
  listings: ListingSummary[];
}
