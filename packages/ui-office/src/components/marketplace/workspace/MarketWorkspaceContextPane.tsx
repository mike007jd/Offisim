import type { ListingDetail } from '@offisim/registry-client';
import { Badge } from '@offisim/ui-core';
import { Package, Shield, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRegistryClient } from '../../../hooks/useRegistryClient.js';
import { KIND_ICON, formatInstallCount, formatRiskLabel } from '../marketplace-meta.js';

export interface MarketWorkspaceContextPaneProps {
  selectedListingId: string | null;
}

export function MarketWorkspaceContextPane({
  selectedListingId,
}: MarketWorkspaceContextPaneProps) {
  const client = useRegistryClient();
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedListingId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    client
      .getListingDetail(selectedListingId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, selectedListingId]);

  if (!selectedListingId) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Package className="h-4 w-4 text-slate-500" />
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Select a listing to view details
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-4 py-6">
        <p className="text-xs text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="px-4 py-6">
        <p className="text-xs text-slate-500">Could not load listing details.</p>
      </div>
    );
  }

  const Icon = KIND_ICON[detail.kind];

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {/* Identity */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-cyan-300">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{detail.title}</p>
          <p className="text-[11px] text-slate-400">@{detail.creator.handle}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5 fill-current text-amber-300" />
          {detail.rating.toFixed(1)}
        </span>
        <span>{formatInstallCount(detail.install_count)} installs</span>
        <Badge variant="info" className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          {detail.kind.replace('_', ' ')}
        </Badge>
      </div>

      {/* Permissions */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-white mb-2">
          <Shield className="h-3.5 w-3.5 text-cyan-300" />
          Permissions
        </div>
        <dl className="space-y-1.5 text-xs text-slate-300">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Risk</dt>
            <dd>{formatRiskLabel(detail.permissions.risk_class)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Filesystem</dt>
            <dd>{detail.permissions.filesystem_scope ?? 'none'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Network</dt>
            <dd>{detail.permissions.network_scope ?? 'none'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Secrets</dt>
            <dd>{detail.permissions.declares_secrets ? 'Declared' : 'None'}</dd>
          </div>
        </dl>
      </section>

      {/* Metadata */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="text-xs font-semibold text-white mb-2">Metadata</p>
        <dl className="space-y-1.5 text-xs text-slate-300">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Version</dt>
            <dd>{detail.latest_version}</dd>
          </div>
          {detail.tags && detail.tags.length > 0 ? (
            <div>
              <dt className="text-slate-500 mb-1">Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {detail.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-300"
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
