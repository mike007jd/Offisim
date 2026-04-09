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
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center h-full">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_0_20px_rgba(34,211,238,0.04)]">
          <Package className="h-5 w-5 text-slate-500" />
        </div>
        <p className="text-[13px] text-slate-500">Select a listing</p>
      </div>
    );
  }

  const Icon = KIND_ICON[detail.kind];

  return (
    <div className="flex flex-col gap-4 px-5 py-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/[0.08] text-cyan-300">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{detail.title}</p>
          <p className="text-[12px] text-slate-500">@{detail.creator.handle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 text-amber-300">
          <Star className="h-3 w-3 fill-current" /> {detail.rating.toFixed(1)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 text-slate-400">
          {formatInstallCount(detail.install_count)}
        </span>
        <Badge variant="info" className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          {detail.kind.replace('_', ' ')}
        </Badge>
      </div>

      <PermissionsBlock permissions={detail.permissions} variant="compact" />

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
        <dl className="space-y-2 text-[12px]">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Version</dt>
            <dd className="text-slate-300 font-mono">{detail.latest_version}</dd>
          </div>
          {detail.tags && detail.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {detail.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-[11px] text-slate-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}
