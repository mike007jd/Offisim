import type { ListingDetail, Review, VersionSummary } from '@offisim/registry-client';
import {
  Badge,
  Button,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { Download, ExternalLink, Shield, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRegistryClient } from '../../hooks/useRegistryClient.js';
import { KIND_ICON, formatInstallCount, formatRiskLabel } from './marketplace-meta.js';

interface MarketplaceDetailOverlayProps {
  readonly listingId: string;
  readonly onClose: () => void;
  readonly onInstall: (listingId: string, version: string) => void;
}

const INSTALLABLE_KINDS = new Set(['employee', 'skill']);

export function MarketplaceDetailOverlay({
  listingId,
  onClose,
  onInstall,
}: MarketplaceDetailOverlayProps) {
  const client = useRegistryClient();
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [readme, setReadme] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setReadme(null);

      try {
        const [detailResponse, versionResponse, reviewResponse] = await Promise.all([
          client.getListingDetail(listingId),
          client.listListingVersions(listingId),
          client.listListingReviews(listingId),
        ]);

        if (cancelled) return;

        setDetail(detailResponse);
        setVersions(versionResponse.versions);
        setReviews(reviewResponse.reviews);
        setSelectedVersion(detailResponse.latest_version);

        const readmePreview = detailResponse.previews?.find((preview) => preview.kind === 'readme');
        if (readmePreview?.url) {
          fetch(readmePreview.url)
            .then(async (response) => {
              if (!response.ok) return null;
              return response.text();
            })
            .then((text) => {
              if (!cancelled && text) setReadme(text);
            })
            .catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load listing');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [client, listingId]);

  const heroImage = detail?.previews?.find((preview) => preview.kind === 'image');
  const canInstall = detail ? INSTALLABLE_KINDS.has(detail.kind) : false;
  const Icon = detail ? KIND_ICON[detail.kind] : null;

  const reviewSummary = useMemo(() => {
    if (reviews.length === 0) return 'No reviews yet';
    const average = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
    return `${average.toFixed(1)} average from ${reviews.length} review${reviews.length === 1 ? '' : 's'}`;
  }, [reviews]);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="absolute inset-x-6 inset-y-6 rounded-[28px] border border-white/10 bg-slate-950/95 shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-cyan-300">
                {Icon ? <Icon className="h-6 w-6" /> : null}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Marketplace Listing
                </p>
                <h2 className="truncate text-2xl font-semibold text-white">
                  {detail?.title ?? 'Loading…'}
                </h2>
                {detail ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                    <span>@{detail.creator.handle}</span>
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-4 w-4 fill-current text-amber-300" />
                      {detail.rating.toFixed(1)}
                    </span>
                    <span>{formatInstallCount(detail.install_count)} installs</span>
                    <Badge variant="info" className="text-[10px] uppercase tracking-wide">
                      {detail.kind.replace('_', ' ')}
                    </Badge>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {versions.length > 0 ? (
                <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((version) => (
                      <SelectItem
                        key={version.package_version_id ?? version.version}
                        value={version.version}
                      >
                        {version.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Button
                type="button"
                disabled={!detail || !canInstall}
                onClick={() =>
                  // biome-ignore lint/style/noNonNullAssertion: disabled prop guards detail is non-null
                  onInstall(detail!.listing_id, selectedVersion || detail!.latest_version)
                }
              >
                <Download className="h-4 w-4" />
                {canInstall ? 'Install' : 'Install not supported'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close marketplace detail"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-6">
                {loading ? (
                  <p className="text-sm text-slate-500">Loading listing details…</p>
                ) : null}
                {error ? (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                    {error}
                  </div>
                ) : null}

                {heroImage?.url ? (
                  <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/30">
                    <img
                      src={heroImage.url}
                      alt={heroImage.alt ?? detail?.title ?? 'Marketplace preview'}
                      className="h-72 w-full object-cover"
                    />
                  </div>
                ) : null}

                {detail ? (
                  <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <h3 className="text-sm font-semibold text-white">Description</h3>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300/85">
                      {readme ?? detail.description ?? detail.summary ?? 'No description provided.'}
                    </p>
                  </section>
                ) : null}

                {versions.length > 0 ? (
                  <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <h3 className="text-sm font-semibold text-white">Version history</h3>
                    <div className="mt-4 space-y-3">
                      {versions.map((version) => (
                        <div
                          key={version.package_version_id ?? version.version}
                          className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-slate-100">
                                {version.version}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                Runtime {version.runtime_range} · Schema {version.schema_version}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wide"
                            >
                              {formatRiskLabel(version.risk_class)}
                            </Badge>
                          </div>
                          {version.changelog ? (
                            <p className="mt-3 text-xs leading-relaxed text-slate-300/80">
                              {version.changelog}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="text-sm font-semibold text-white">Reviews</h3>
                  <p className="mt-2 text-xs text-slate-500">{reviewSummary}</p>
                  <div className="mt-4 space-y-3">
                    {reviews.length === 0 ? (
                      <p className="text-sm text-slate-500">No public reviews yet.</p>
                    ) : (
                      reviews.map((review) => (
                        <div
                          key={review.review_id}
                          className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-slate-100">
                              {review.title || 'Untitled review'}
                            </p>
                            <span className="inline-flex items-center gap-1 text-xs text-amber-200">
                              <Star className="h-3.5 w-3.5 fill-current" />
                              {review.rating.toFixed(1)}
                            </span>
                          </div>
                          {review.body ? (
                            <p className="mt-2 text-xs leading-relaxed text-slate-300/80">
                              {review.body}
                            </p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              <aside className="space-y-6">
                {detail ? (
                  <>
                    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <Shield className="h-4 w-4 text-cyan-300" />
                        Permissions
                      </div>
                      <dl className="mt-4 space-y-3 text-sm text-slate-300">
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">Risk</dt>
                          <dd>{formatRiskLabel(detail.permissions.risk_class)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">
                            Filesystem
                          </dt>
                          <dd>{detail.permissions.filesystem_scope ?? 'none'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">
                            Network
                          </dt>
                          <dd>{detail.permissions.network_scope ?? 'none'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">
                            Secrets
                          </dt>
                          <dd>{detail.permissions.declares_secrets ? 'Declared' : 'None'}</dd>
                        </div>
                      </dl>
                    </section>

                    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                      <h3 className="text-sm font-semibold text-white">Package metadata</h3>
                      <dl className="mt-4 space-y-3 text-sm text-slate-300">
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">
                            Latest version
                          </dt>
                          <dd>{detail.latest_version}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">Tags</dt>
                          <dd>{detail.tags?.join(', ') || 'No tags'}</dd>
                        </div>
                        {detail.previews?.map((preview) => (
                          <div key={`${preview.kind}-${preview.url}`}>
                            <dt className="text-xs uppercase tracking-wide text-slate-500">
                              {preview.kind}
                            </dt>
                            <dd>
                              <a
                                href={preview.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
                              >
                                Open preview
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    {!canInstall ? (
                      <div className="rounded-3xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">
                        This package kind can be published and browsed, but the current installer
                        only materializes employee and skill assets into live runtime entities.
                      </div>
                    ) : null}
                  </>
                ) : null}
              </aside>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
