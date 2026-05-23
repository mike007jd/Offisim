import { Button } from '@offisim/ui-core';
import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { revealWorkspaceFolder } from '../../lib/folder-picker';
import { useOffisimRuntimeDesktopHost } from '../../runtime/offisim-runtime-context';
import { SurfaceCard } from './settings-primitives';

interface VaultDirectorySectionProps {
  notify: (message: string, variant?: 'info' | 'success' | 'error') => void;
}

export function VaultDirectorySection({ notify }: VaultDirectorySectionProps) {
  const { desktopVaultRoot } = useOffisimRuntimeDesktopHost();
  const [openingFolder, setOpeningFolder] = useState(false);
  const statusText = desktopVaultRoot
    ? 'Desktop stores vault markdown locally and syncs it automatically.'
    : 'Desktop vault sync activates automatically after the workspace runtime is ready.';

  async function handleOpenFolder() {
    if (!desktopVaultRoot || openingFolder) return;
    setOpeningFolder(true);
    try {
      await revealWorkspaceFolder(desktopVaultRoot);
      notify('Opened local vault folder.', 'success');
    } catch {
      notify(
        `Folder not found at ${desktopVaultRoot}. Restart Offisim or rebind the workspace.`,
        'error',
      );
    } finally {
      setOpeningFolder(false);
    }
  }

  return (
    <SurfaceCard
      title="Local vault"
      description="Desktop mode mirrors employee markdown into Offisim's local vault folder automatically."
      icon={<FolderOpen className="h-5 w-5" />}
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-text-primary">{statusText}</p>
          {desktopVaultRoot ? (
            <p className="mt-2 font-mono text-xs text-text-muted">{desktopVaultRoot}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={handleOpenFolder}
            disabled={!desktopVaultRoot || openingFolder}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {openingFolder ? 'Opening...' : 'Open folder'}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}
