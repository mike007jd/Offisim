import type { ListingDetail } from '@offisim/registry-client';
import { Badge } from '@offisim/ui-core';
import { Package, Star } from 'lucide-react';
import { PermissionsBlock } from '../PermissionsBlock.js';
import { KIND_ICON, formatInstallCount } from '../marketplace-meta.js';

export interface MarketWorkspaceContextPaneProps {
  detail: ListingDetail | null;
  loading: boolean;
  unavailable?: boolean;
}

export function MarketWorkspaceContextPane({
  detail,
  loading,
  unavailable,
}: MarketWorkspaceContextPaneProps) {
  if (loading) {
    return (
      <div className="px-4 py-6">
        <p className="text-xs text-slate-500">Loading…</p>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="px-4 py-6">
        <p className="text-xs text-slate-500">This listing is no longer available.</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center h-full">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Package className="h-5 w-5 text-slate-500" />
        </div>
        <p className="text-sm leading-relaxed text-slate-500">Select a listing to view details</p>
      </div>
    );
  }

  const Icon = KIND_ICON[detail.kind];

  return (
    <div className="flex flex-col gap-5 px-5 py-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-cyan-300">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{detail.title}</p>
          <p className="text-sm text-slate-400">@{detail.creator.handle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5 fill-current text-amber-300" />
          {detail.rating.toFixed(1)}
        </span>
        <span>{formatInstallCount(detail.install_count)} installs</span>
        <Badge variant="info" className="px-1.5 py-0.5 text-xs uppercase tracking-wide">
          {detail.kind.replace('_', ' ')}
        </Badge>
      </div>

      <PermissionsBlock permissions={detail.permissions} variant="compact" />

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-semibold text-white">Metadata</p>
        <dl className="space-y-1.5 text-xs text-slate-300">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Version</dt>
            <dd>{detail.latest_version}</dd>
          </div>
          {detail.tags && detail.tags.length > 0 ? (
            <div>
              <dt className="mb-1 text-slate-500">Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {detail.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}
