import type { InstalledPackageRow } from '@offisim/install-core';
import { Badge, Button, EmptyState } from '@offisim/ui-core';
import { RefreshCcw, Store, UploadCloud } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegistryClient } from '../../hooks/useRegistryClient.js';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context.js';
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
  const { repos } = useOffisimRuntimeServices();
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
    return <p className="market-installed-loading">Loading installed packages...</p>;
  }

  if (actionableItems.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title="No installed market packages"
        description="Packages installed from the marketplace will appear here for manual update checks."
      />
    );
  }

  return (
    <div className="market-installed-list">
      {actionableItems.map((item) => {
        const update = updates[item.installed_package_id];
        const canCheck = Boolean(item.origin_listing_id);

        return (
          <div key={item.installed_package_id} className="market-installed-card">
            <div className="market-installed-card-head">
              <div className="market-installed-card-title">
                <p>{item.package_id}</p>
                <p>
                  v{item.version} · {new Date(item.installed_at).toLocaleDateString()}
                </p>
              </div>
              {update?.hasUpdate && (
                <Badge variant="success" size="xs" className="market-installed-update-badge">
                  Update
                </Badge>
              )}
            </div>

            {update?.error && <p className="market-installed-error">{update.error}</p>}
            {!update?.error && update && (
              <p className="market-installed-version">
                Latest registry version: {update.latestVersion}
              </p>
            )}

            <div className="market-installed-actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canCheck || checkingId === item.installed_package_id}
                onClick={() => void checkForUpdate(item)}
                className="market-installed-action"
              >
                <RefreshCcw data-icon="action" />
                {checkingId === item.installed_package_id ? 'Checking...' : 'Check update'}
              </Button>

              {item.origin_listing_id && update?.hasUpdate && (
                <Button
                  type="button"
                  size="sm"
                  // biome-ignore lint/style/noNonNullAssertion: prior null check guarantees defined
                  onClick={() => onStartInstall(item.origin_listing_id!, update.latestVersion)}
                  className="market-installed-action"
                >
                  <UploadCloud data-icon="action" />
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
