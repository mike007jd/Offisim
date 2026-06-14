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

export const REGISTRY_CLIENT_MAX_JSON_BYTES = 1024 * 1024;
export const REGISTRY_CLIENT_TIMEOUT_MS = 10_000;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = 300 * 2 ** attempt; // 300, 600, 1200ms
  const jitter = base * (0.5 + Math.random() * 0.5);
  return Math.min(jitter, 5_000);
}

function parseRetryAfterMs(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * Backoff delay for a failed idempotent (GET) request, or null if the error is
 * not transient and should not be retried. Retries 429 / 5xx (honoring
 * Retry-After) and network/timeout errors; never retries other 4xx, redirects,
 * or non-network failures (e.g. JSON parse).
 */
function idempotentRetryDelayMs(err: unknown, attempt: number): number | null {
  if (err instanceof RegistryApiError) {
    if (err.status === 429 || err.status >= 500) {
      return parseRetryAfterMs(err.details?.retryAfter) ?? backoffMs(attempt);
    }
    return null;
  }
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TypeError') return backoffMs(attempt);
  return null;
}

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

  /** Whether an auth token is configured on this client instance. */
  get hasAuthToken(): boolean {
    return !!this.authToken;
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

  async deleteMyDraft(draftId: string): Promise<{ deleted: boolean; draft_id: string }> {
    return this.delete<{ deleted: boolean; draft_id: string }>(`/v1/publish/drafts/${draftId}`);
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
    if (this.authToken) h.Authorization = `Bearer ${this.authToken}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REGISTRY_CLIENT_TIMEOUT_MS);
    try {
      const res = await this.fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
        credentials: this.credentials,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (REDIRECT_STATUS_CODES.has(res.status)) {
        throw new RegistryApiError(
          res.status,
          'REDIRECT_NOT_ALLOWED',
          'Registry API redirects are not allowed',
        );
      }

      if (!res.ok) {
        const errorBody = (await readRegistryJson(res).catch(() => ({}))) as Record<
          string,
          unknown
        >;
        const fallback = { code: 'UNKNOWN', message: res.statusText };
        const errObj = (errorBody.error ?? fallback) as {
          code: string;
          message: string;
          details?: Record<string, unknown>;
        };
        const retryAfter = res.headers.get('retry-after');
        throw new RegistryApiError(res.status, errObj.code, errObj.message, {
          ...errObj.details,
          ...(retryAfter ? { retryAfter } : {}),
        });
      }

      return await readRegistryJson<T>(res);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // GETs are idempotent, so transient failures (429 / 5xx / network / timeout)
  // are retried with bounded exponential backoff, honoring Retry-After. Mutating
  // verbs (POST/PUT/PATCH/DELETE) deliberately do NOT auto-retry.
  private async get<T>(path: string): Promise<T> {
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await this.request<T>('GET', path);
      } catch (err) {
        lastErr = err;
        const delay = idempotentRetryDelayMs(err, attempt);
        if (delay === null || attempt === MAX_ATTEMPTS - 1) throw err;
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

async function readRegistryJson<T = unknown>(response: Response): Promise<T> {
  const text = await readRegistryTextWithLimit(response, REGISTRY_CLIENT_MAX_JSON_BYTES);
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}

async function readRegistryTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  return readResponseTextWithLimit(response, maxBytes, {
    missingBodyMessage: 'Registry response did not expose a readable stream',
    tooLargeMessage: `Registry response exceeded ${maxBytes} bytes`,
  });
}

export interface ReadResponseTextWithLimitOptions {
  abortController?: AbortController;
  allowTextFallback?: boolean;
  missingBodyMessage?: string;
  tooLargeMessage?: string;
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  options: ReadResponseTextWithLimitOptions = {},
): Promise<string> {
  const tooLargeMessage = options.tooLargeMessage ?? `Response exceeded ${maxBytes} bytes`;
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      options.abortController?.abort();
      throw new Error(tooLargeMessage);
    }
  }

  if (!response.body) {
    if (!options.allowTextFallback) {
      throw new Error(options.missingBodyMessage ?? 'Response did not expose a readable stream');
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      options.abortController?.abort();
      throw new Error(tooLargeMessage);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        options.abortController?.abort();
        throw new Error(tooLargeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
