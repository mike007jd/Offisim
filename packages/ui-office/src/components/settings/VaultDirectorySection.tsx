import { pickBrowserVaultDirectory } from '@offisim/core/browser';
import { Button } from '@offisim/ui-core';
import { FolderOpen, Link2Off, PackageOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openDesktopLocalPath } from '../../lib/desktop-local-paths';
import { isTauri } from '../../lib/env';
import { exportVaultSnapshotZip } from '../../lib/vault-export';
import {
  type VaultDirectoryStatus,
  useOffisimRuntime,
} from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext';
import { SurfaceCard } from './settings-primitives';

interface VaultDirectorySectionProps {
  notify: (message: string, variant?: 'info' | 'success' | 'error') => void;
}

const UNSUPPORTED_MESSAGE =
  'Your browser does not support live mounting. Use Export to download a snapshot.';

export function VaultDirectorySection({ notify }: VaultDirectorySectionProps) {
  const { activeCompanyId } = useCompany();
  const runtime = useOffisimRuntime();
  const desktopMode = isTauri();
  const [status, setStatus] = useState<VaultDirectoryStatus>({
    supported: false,
    mode: 'unsupported',
    directoryName: null,
    errorMessage: null,
  });
  const [busy, setBusy] = useState<'mount' | 'unmount' | 'export' | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!runtime.getVaultDirectoryStatus) return;
    void runtime.getVaultDirectoryStatus().then((nextStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const handleMount = async () => {
    if (!runtime.mountVaultDirectory) return;
    setBusy('mount');
    try {
      const pickedHandle =
        status.mode === 'unmounted' && status.supported
          ? await pickBrowserVaultDirectory()
          : undefined;
      const nextStatus = await runtime.mountVaultDirectory(pickedHandle);
      setStatus(nextStatus);
      if (nextStatus.mode === 'mounted') {
        notify(`Vault directory mounted: ${nextStatus.directoryName}`, 'success');
      }
    } catch (err) {
      if (err instanceof Error) {
        const detail = err.message ? `${err.name}: ${err.message}` : err.name;
        notify(`Mount directory failed: ${detail}`, 'error');
      } else {
        notify(`Mount directory failed: ${String(err)}`, 'error');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleUnmount = async () => {
    if (!runtime.unmountVaultDirectory) return;
    setBusy('unmount');
    try {
      const nextStatus = await runtime.unmountVaultDirectory();
      setStatus(nextStatus);
      notify('Vault directory unmounted. Live sync is off until you mount again.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async () => {
    if (!activeCompanyId || !runtime.repos) {
      notify('Select a company before exporting a vault snapshot.', 'error');
      return;
    }
    setBusy('export');
    try {
      if (runtime.exportVaultSnapshotZip) {
        await runtime.exportVaultSnapshotZip();
        notify('Vault snapshot exported.', 'success');
      } else {
        const { fileCount } = await exportVaultSnapshotZip(runtime.repos, activeCompanyId);
        notify(`Vault snapshot exported (${fileCount} files).`, 'success');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const statusText =
    status.mode === 'mounted'
      ? `Live sync mounted to ${status.directoryName}`
      : status.mode === 'error'
        ? status.errorMessage
          ? `Live sync failed for ${status.directoryName ?? 'the selected directory'}: ${status.errorMessage}`
          : `Live sync failed for ${status.directoryName ?? 'the selected directory'}.`
        : status.mode === 'needs-permission'
          ? `Saved handle found for ${status.directoryName}. Re-mount to renew permission.`
          : status.supported
            ? 'Live sync is currently off. Mount a local directory to mirror the vault.'
            : UNSUPPORTED_MESSAGE;

  const mountLabel =
    status.mode === 'needs-permission'
      ? 'Reconnect directory'
      : status.mode === 'error'
        ? 'Retry mount'
        : busy === 'mount'
          ? 'Mounting…'
          : 'Mount directory';

  if (desktopMode) {
    const desktopVaultRoot = runtime.desktopVaultRoot ?? null;
    const statusText = desktopVaultRoot
      ? 'Desktop stores vault markdown locally and syncs it automatically.'
      : 'Desktop vault sync activates automatically after the workspace runtime is ready.';

    return (
      <SurfaceCard
        title="Local vault"
        description="Desktop mode mirrors employee markdown into Offisim’s local vault folder automatically."
        icon={<FolderOpen className="h-5 w-5" />}
      >
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-200">{statusText}</p>
            {desktopVaultRoot ? (
              <p className="mt-2 font-mono text-xs text-slate-400">{desktopVaultRoot}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                if (!desktopVaultRoot) return;
                try {
                  await openDesktopLocalPath(desktopVaultRoot);
                } catch (err) {
                  notify(err instanceof Error ? err.message : String(err), 'error');
                }
              }}
              disabled={!desktopVaultRoot}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Open folder
            </Button>
          </div>
        </div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      title="Vault directory"
      description="Mirror employee markdown into a browser-mounted folder, or export a zip snapshot."
      icon={<FolderOpen className="h-5 w-5" />}
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm text-slate-200">{statusText}</p>
          {status.root ? (
            <p className="mt-2 font-mono text-xs text-slate-400">{status.root}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          {status.supported ? (
            <>
              <Button type="button" onClick={handleMount} disabled={busy !== null}>
                {mountLabel}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleUnmount}
                disabled={busy !== null}
              >
                <Link2Off className="mr-2 h-4 w-4" />
                {busy === 'unmount' ? 'Unmounting…' : 'Unmount'}
              </Button>
            </>
          ) : null}
          <Button type="button" variant="secondary" onClick={handleExport} disabled={busy !== null}>
            <PackageOpen className="mr-2 h-4 w-4" />
            {busy === 'export' ? 'Exporting…' : 'Export zip'}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}
