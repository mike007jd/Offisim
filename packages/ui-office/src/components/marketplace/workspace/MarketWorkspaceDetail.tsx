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
import { ArrowLeft, Download, ExternalLink, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRegistryClient } from '../../../hooks/useRegistryClient.js';
import { PermissionsBlock } from '../PermissionsBlock.js';
import {
  INSTALLABLE_KINDS,
  KIND_ICON,
  formatInstallCount,
  formatRiskLabel,
} from '../marketplace-meta.js';

export interface MarketWorkspaceDetailProps {
  listingId: string;
  detail: ListingDetail | null;
  detailLoading: boolean;
  detailUnavailable: boolean;
  onBack: () => void;
  onInstall: (listingId: string, version: string) => void;
}

export function MarketWorkspaceDetail({
  listingId,
  detail,
  detailLoading,
  detailUnavailable,
  onBack,
  onInstall,
}: MarketWorkspaceDetailProps) {
  const client = useRegistryClient();
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [readme, setReadme] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [extraLoading, setExtraLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setExtraLoading(true);
      setError(null);
      setReadme(null);

      try {
        const [versionResponse, reviewResponse] = await Promise.all([
          client.listListingVersions(listingId),
          client.listListingReviews(listingId),
        ]);

        if (cancelled) return;

        setVersions(versionResponse.versions);
        setReviews(reviewResponse.reviews);
        if (detail?.latest_version) {
          setSelectedVersion(detail.latest_version);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load listing');
      } finally {
        if (!cancelled) setExtraLoading(false);
      }
    }

    // Fetch versions + reviews once detail is available (or immediately if provided later)
    void load();

    return () => {
      cancelled = true;
    };
  }, [client, listingId, detail?.latest_version]);

  // Fetch readme separately (depends on detail which comes from parent)
  useEffect(() => {
    if (!detail) return;

    const readmePreview = detail.previews?.find((p) => p.kind === 'readme');
    if (!readmePreview?.url) return;

    let cancelled = false;
    fetch(readmePreview.url)
      .then(async (r) => (r.ok ? r.text() : null))
      .then((text) => {
        if (!cancelled && text) setReadme(text);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [detail]);

  const heroImage = detail?.previews?.find((p) => p.kind === 'image');
  const canInstall = detail ? INSTALLABLE_KINDS.has(detail.kind) : false;
  const Icon = detail ? KIND_ICON[detail.kind] : null;

  const reviewSummary = useMemo(() => {
    if (reviews.length === 0) return 'No reviews yet';
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    return `${avg.toFixed(1)} average from ${reviews.length} review${reviews.length === 1 ? '' : 's'}`;
  }, [reviews]);

  if (detailUnavailable) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <p className="text-sm font-semibold text-slate-200">Listing unavailable</p>
          <p className="text-xs leading-relaxed text-slate-500">
            This listing may have been removed or is no longer accessible.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            Back to explore
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </div>

      <ScrollArea className="flex-1">
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
                {detailLoading ? 'Loading…' : (detail?.title ?? 'Unknown')}
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

          <div className="flex shrink-0 items-center gap-2">
            {versions.length > 0 ? (
              <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.package_version_id ?? v.version} value={v.version}>
                      {v.version}
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
          </div>
        </div>

        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            {detailLoading || extraLoading ? (
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
                  {versions.map((v) => (
                    <div
                      key={v.package_version_id ?? v.version}
                      className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-100">{v.version}</p>
                          <p className="text-[11px] text-slate-500">
                            Runtime {v.runtime_range} · Schema {v.schema_version}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          {formatRiskLabel(v.risk_class)}
                        </Badge>
                      </div>
                      {v.changelog ? (
                        <p className="mt-3 text-xs leading-relaxed text-slate-300/80">
                          {v.changelog}
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
                <PermissionsBlock permissions={detail.permissions} variant="wide" />

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
                    This package kind can be published and browsed, but the current installer only
                    materializes employee and skill assets into live runtime entities.
                  </div>
                ) : null}
              </>
            ) : null}
          </aside>
        </div>
      </ScrollArea>
    </div>
  );
}
