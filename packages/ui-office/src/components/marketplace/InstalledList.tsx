import type { InstalledPackageRow } from '@offisim/install-core';
import { Button } from '@offisim/ui-core';
import { RefreshCcw, Store, UploadCloud } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegistryClient } from '../../hooks/useRegistryClient.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context.js';
import { useCompany } from '../company/CompanyContext.js';

interface InstalledListProps {
  readonly onStartInstall: (listingId: string, version: string) => void;
}

interface UpdateState {
  readonly latestVersion: string;
  readonly hasUpdate: boolean;
  readonly error?: string;
}

function parseVersion(version: string): number[] {
  return version.split('.').map((part) => {
    const value = Number(part);
    return Number.isFinite(value) ? value : 0;
  });
}

function compareVersionStrings(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }

  return 0;
}

export function InstalledList({ onStartInstall }: InstalledListProps) {
  const client = useRegistryClient();
  const { repos } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [items, setItems] = useState<InstalledPackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, UpdateState>>({});

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const installed = await repos.installedPackages.listByCompany(activeCompanyId);
      setItems(installed);
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, repos]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checkForUpdate = useCallback(
    async (item: InstalledPackageRow) => {
      if (!item.origin_listing_id) return;

      setCheckingId(item.installed_package_id);
      try {
        const response = await client.listListingVersions(item.origin_listing_id);
        const latest =
          response.versions.length > 0
            ? response.versions.reduce((max, v) =>
                compareVersionStrings(v.version, max.version) > 0 ? v : max,
              )
            : undefined;
        if (!latest) {
          setUpdates((prev) => ({
            ...prev,
            [item.installed_package_id]: {
              latestVersion: item.version,
              hasUpdate: false,
              error: 'No active versions found',
            },
          }));
          return;
        }

        setUpdates((prev) => ({
          ...prev,
          [item.installed_package_id]: {
            latestVersion: latest.version,
            hasUpdate: compareVersionStrings(item.version, latest.version) < 0,
          },
        }));
      } catch (err) {
        setUpdates((prev) => ({
          ...prev,
          [item.installed_package_id]: {
            latestVersion: item.version,
            hasUpdate: false,
            error: err instanceof Error ? err.message : 'Update check failed',
          },
        }));
      } finally {
        setCheckingId(null);
      }
    },
    [client],
  );

  const actionableItems = useMemo(
    () => items.filter((item) => item.install_state === 'installed'),
    [items],
  );

  if (loading) {
    return <p className="px-3 py-6 text-sm text-slate-500">Loading installed packages…</p>;
  }

  if (actionableItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Store className="h-5 w-5 text-slate-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">No installed market packages</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Packages installed from the marketplace will appear here for manual update checks.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      {actionableItems.map((item) => {
        const update = updates[item.installed_package_id];
        const canCheck = Boolean(item.origin_listing_id);

        return (
          <div
            key={item.installed_package_id}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{item.package_id}</p>
                <p className="text-[11px] text-slate-400">
                  v{item.version} · {new Date(item.installed_at).toLocaleDateString()}
                </p>
              </div>
              {update?.hasUpdate && (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200">
                  Update
                </span>
              )}
            </div>

            {update?.error && <p className="mt-2 text-[11px] text-rose-300">{update.error}</p>}
            {!update?.error && update && (
              <p className="mt-2 text-[11px] text-slate-400">
                Latest registry version: {update.latestVersion}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canCheck || checkingId === item.installed_package_id}
                onClick={() => void checkForUpdate(item)}
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {checkingId === item.installed_package_id ? 'Checking…' : 'Check update'}
              </Button>

              {item.origin_listing_id && update?.hasUpdate && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onStartInstall(item.origin_listing_id!, update.latestVersion)}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  Update
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
