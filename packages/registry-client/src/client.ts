import { RegistryApiError } from './errors.js';
import type {
  ArtifactDownloadInfo,
  CreateDraftRequest,
  CreateReportRequest,
  CreateReviewRequest,
  CreatorProfile,
  ForksResponse,
  InstallReceiptRequest,
  InstallReceiptResponse,
  LibraryParams,
  LibraryResponse,
  LineageResponse,
  ListDraftsParams,
  ListDraftsResponse,
  ListingDetail,
  MyCreatorResponse,
  PublishDraft,
  PublishSubmitRequest,
  PutDraftManifestRequest,
  ReportResponse,
  Review,
  ReviewListResponse,
  SearchParams,
  SearchResponse,
  SubmitResponse,
  VersionListResponse,
} from './types.js';

export interface RegistryClientConfig {
  baseUrl: string;
  authToken?: string;
  /** Send cookies with requests (for browser session-based auth). Default: undefined. */
  credentials?: 'include' | 'same-origin' | 'omit';
  fetch?: typeof globalThis.fetch;
}

export class RegistryClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly credentials?: 'include' | 'same-origin' | 'omit';
  private readonly fetch: typeof globalThis.fetch;

  constructor(config: RegistryClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.credentials = config.credentials;
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ── Public reads ──

  async searchListings(params: SearchParams = {}): Promise<SearchResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.kind) qs.set('kind', params.kind);
    if (params.risk_class) qs.set('risk_class', params.risk_class);
    if (params.tag) qs.set('tag', params.tag);
    if (params.sort) qs.set('sort', params.sort);
    if (params.page) qs.set('page', String(params.page));
    if (params.per_page) qs.set('per_page', String(params.per_page));
    return this.get<SearchResponse>(`/v1/market/search?${qs}`);
  }

  async getListingDetail(listingId: string): Promise<ListingDetail> {
    return this.get<ListingDetail>(`/v1/market/listings/${listingId}`);
  }

  async getListingBySlug(slug: string): Promise<ListingDetail> {
    return this.get<ListingDetail>(`/v1/market/listings/by-slug/${slug}`);
  }

  async listListingVersions(listingId: string): Promise<VersionListResponse> {
    return this.get<VersionListResponse>(`/v1/market/listings/${listingId}/versions`);
  }

  async listListingReviews(listingId: string): Promise<ReviewListResponse> {
    return this.get<ReviewListResponse>(`/v1/market/listings/${listingId}/reviews`);
  }

  async getCreatorProfile(handle: string): Promise<CreatorProfile> {
    return this.get<CreatorProfile>(`/v1/market/creators/${handle}`);
  }

  async getListingForks(listingId: string): Promise<ForksResponse> {
    return this.get<ForksResponse>(`/v1/market/listings/${listingId}/forks`);
  }

  async getListingLineage(listingId: string): Promise<LineageResponse> {
    return this.get<LineageResponse>(`/v1/market/listings/${listingId}/lineage`);
  }

  async reportListing(listingId: string, req: CreateReportRequest): Promise<ReportResponse> {
    return this.post<ReportResponse>(`/v1/market/listings/${listingId}/reports`, req);
  }

  // ── Authenticated endpoints ──

  async createPublishDraft(req: CreateDraftRequest): Promise<PublishDraft> {
    return this.post<PublishDraft>('/v1/publish/drafts', req);
  }

  async putDraftManifest(draftId: string, req: PutDraftManifestRequest): Promise<PublishDraft> {
    return this.put<PublishDraft>(`/v1/publish/drafts/${draftId}/manifest`, req);
  }

  async submitPublishDraft(req: PublishSubmitRequest): Promise<SubmitResponse> {
    return this.post<SubmitResponse>('/v1/publish/submit', req);
  }

  async listMyDrafts(params?: ListDraftsParams): Promise<ListDraftsResponse> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return this.get<ListDraftsResponse>(`/v1/publish/drafts${query ? `?${query}` : ''}`);
  }

  async getMyCreatorProfile(): Promise<MyCreatorResponse> {
    return this.get<MyCreatorResponse>('/v1/publish/me');
  }

  async upsertReview(req: CreateReviewRequest): Promise<Review> {
    return this.post<Review>('/v1/reviews', req);
  }

  // ── Install support ──

  async getArtifactDownloadInfo(packageVersionId: string): Promise<ArtifactDownloadInfo> {
    return this.get<ArtifactDownloadInfo>(`/v1/install/download/${packageVersionId}`);
  }

  async reportInstall(req: InstallReceiptRequest): Promise<InstallReceiptResponse> {
    return this.post<InstallReceiptResponse>('/v1/install/receipts', req);
  }

  // ── Library ──

  async getMyLibrary(params?: LibraryParams): Promise<LibraryResponse> {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.installed !== undefined) qs.set('installed', String(params.installed));
    const query = qs.toString();
    return this.get<LibraryResponse>(`/v1/me/library${query ? `?${query}` : ''}`);
  }

  // ── Internal ──

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      credentials: this.credentials,
    });

    if (!res.ok) {
      const errorBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const fallback = { code: 'UNKNOWN', message: res.statusText };
      const errObj = (errorBody.error ?? fallback) as {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
      throw new RegistryApiError(res.status, errObj.code, errObj.message, errObj.details);
    }

    return res.json() as Promise<T>;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
}
