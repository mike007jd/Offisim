import { type SceneDropDiagnostic, useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { queryKeys } from '@/data/query-keys.js';
import { CapsLabel, CardBlock } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Download, FolderOpen, Package } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { TokenBudgetSettingsCard } from './TokenBudgetSettingsCard.js';

interface RuntimeVaultStatus {
  readonly path: string;
  readonly displayPath: string;
  readonly employees: number;
  readonly files: number;
  readonly sizeBytes: number;
  readonly size: string;
  readonly available: boolean;
}

interface LocalExportResult {
  readonly path: string;
  readonly displayPath: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly size: string;
}

async function loadRuntimeVaultStatus(): Promise<RuntimeVaultStatus> {
  if (!isTauriRuntime()) {
    return {
      path: '',
      displayPath: 'Desktop runtime unavailable',
      employees: 0,
      files: 0,
      sizeBytes: 0,
      size: '0 B',
      available: false,
    };
  }
  return invokeCommand('runtime_vault_status');
}

function sceneDiagnosticPayload(events: SceneDropDiagnostic[]): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      source: 'settings.runtime.scene-drop-diagnostic',
      eventCount: events.length,
      events,
    },
    null,
    2,
  );
}

/**
 * Runtime settings pane. The autonomy level (Plan / Ask / Auto / Full), model,
 * and thinking level are all chosen per conversation from the composer — they
 * are the only runtime knobs the session reads — so this pane carries no global
 * runtime form. It keeps only cost controls and genuinely local advanced actions.
 */
export function RuntimePane() {
  const sceneDropDiagnostics = useUiState((s) => s.sceneDropDiagnostics);
  const [openingVault, setOpeningVault] = useState(false);
  const [exportingVaultZip, setExportingVaultZip] = useState(false);
  const [exportingSceneDiagnostic, setExportingSceneDiagnostic] = useState(false);
  const [lastVaultExport, setLastVaultExport] = useState<LocalExportResult | null>(null);
  const [lastSceneDiagnostic, setLastSceneDiagnostic] = useState<LocalExportResult | null>(null);
  const vaultQuery = useQuery({
    queryKey: queryKeys.settingsRuntimeVaultStatus(),
    queryFn: loadRuntimeVaultStatus,
  });
  const vaultStatus = vaultQuery.data;
  const tauriAvailable = isTauriRuntime();
  const canOpenVault = tauriAvailable && !openingVault;
  const canExportVaultZip = tauriAvailable && !exportingVaultZip;
  const canExportSceneDiagnostic = tauriAvailable && !exportingSceneDiagnostic;

  async function handleOpenVaultFolder() {
    if (!canOpenVault) return;
    setOpeningVault(true);
    try {
      await invokeCommand('open_runtime_vault_folder');
      await vaultQuery.refetch();
      toast.success('Opened local vault folder');
    } catch (error) {
      toast.error('Could not open local vault folder', { description: safeErrorMessage(error) });
    } finally {
      setOpeningVault(false);
    }
  }

  async function handleExportVaultZip() {
    if (!canExportVaultZip) return;
    setExportingVaultZip(true);
    try {
      const result = await invokeCommand('export_runtime_vault_zip');
      setLastVaultExport(result);
      await vaultQuery.refetch();
      toast.success('Exported vault zip', { description: result.displayPath });
    } catch (error) {
      toast.error('Could not export vault zip', { description: safeErrorMessage(error) });
    } finally {
      setExportingVaultZip(false);
    }
  }

  async function handleExportSceneDiagnostic() {
    if (!canExportSceneDiagnostic) return;
    setExportingSceneDiagnostic(true);
    try {
      const result = await invokeCommand('export_scene_drop_diagnostic', {
        diagnosticsJson: sceneDiagnosticPayload(sceneDropDiagnostics),
      });
      setLastSceneDiagnostic(result);
      toast.success('Exported scene diagnostic', { description: result.displayPath });
    } catch (error) {
      toast.error('Could not export scene diagnostic', { description: safeErrorMessage(error) });
    } finally {
      setExportingSceneDiagnostic(false);
    }
  }

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">Usage &amp; Storage</div>
        <div className="off-set-panedesc">
          Set usage alerts, manage local employee data, and export diagnostics.
        </div>
      </div>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Cost alerts</CapsLabel>
        </div>
        <TokenBudgetSettingsCard />
      </section>

      {/* Advanced — genuinely local actions only. */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Advanced</CapsLabel>
        </div>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Local vault
          </summary>
          <div className="off-set-disclosure-body">
            <CardBlock className="off-set-vault-card">
              {/* Status/actions/path live inside the head's text column so all
                  card text shares the title's left edge (not the icon's). */}
              <div className="off-set-vault-head">
                <span className="off-set-vault-ico">
                  <Icon icon={FolderOpen} size="sm" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="off-set-vault-title">
                    Local vault <span className="off-set-mode-tag">Desktop</span>
                  </div>
                  <div className="off-set-vault-sub">
                    Employee files are mirrored to a local folder.
                  </div>
                  <div className="off-set-vault-status">
                    {vaultQuery.isLoading ? (
                      'Checking local vault…'
                    ) : vaultQuery.isError ? (
                      'Local vault status unavailable'
                    ) : (
                      <>
                        {vaultStatus?.employees ?? 0} employees · {vaultStatus?.files ?? 0} markdown
                        files · {vaultStatus?.size ?? '0 B'}
                      </>
                    )}
                    <div className="off-set-vault-path">
                      {vaultStatus?.displayPath ?? 'Desktop runtime unavailable'}
                    </div>
                  </div>
                  <div className="off-set-vault-actions">
                    <Button
                      variant="outline"
                      size="md"
                      disabled={!canOpenVault}
                      title={
                        tauriAvailable
                          ? 'Open the local vault folder in the OS file manager'
                          : 'Local vault folder is only available in the desktop runtime'
                      }
                      onClick={handleOpenVaultFolder}
                    >
                      <Icon icon={FolderOpen} size="sm" />
                      {openingVault ? 'Opening…' : 'Open folder'}
                    </Button>
                  </div>
                </div>
              </div>
            </CardBlock>
            <CardBlock className="off-set-vault-card">
              <div className="off-set-vault-head">
                <span className="off-set-vault-ico">
                  <Icon icon={FolderOpen} size="sm" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="off-set-vault-title">
                    Vault snapshot <span className="off-set-mode-tag">Desktop</span>
                  </div>
                  <div className="off-set-vault-sub">
                    Export a zip snapshot of the current vault for backup or handoff.
                  </div>
                  <div className="off-set-vault-status">
                    Exports write to Offisim's app-local exports folder with the current employee
                    vault files.
                  </div>
                  <div className="off-set-vault-actions">
                    <Button
                      variant="outline"
                      size="md"
                      disabled={!canExportVaultZip}
                      title={
                        tauriAvailable
                          ? 'Export the current local vault snapshot as a zip file'
                          : 'Vault zip export is only available in the desktop runtime'
                      }
                      onClick={handleExportVaultZip}
                    >
                      <Icon icon={Package} size="sm" />
                      {exportingVaultZip ? 'Exporting…' : 'Export zip'}
                    </Button>
                  </div>
                  {lastVaultExport ? (
                    <div className="off-set-vault-path">
                      Last zip: {lastVaultExport.fileName} · {lastVaultExport.size}
                    </div>
                  ) : null}
                </div>
              </div>
            </CardBlock>
          </div>
        </details>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            2D scene diagnostics
          </summary>
          <div className="off-set-disclosure-body">
            <div className="off-set-sec-hint mb-[var(--off-sp-3)] mt-0">
              Export recent drag-and-drop events as JSON for support.
            </div>
            <div className="off-set-diag-last">
              <Icon icon={Check} size="sm" />
              Recorded attempts: <b>{sceneDropDiagnostics.length}</b>
              {lastSceneDiagnostic ? (
                <>
                  {' '}
                  · Last export: <span className="off-mono">{lastSceneDiagnostic.fileName}</span>
                </>
              ) : null}
            </div>
            <div className="mt-[var(--off-sp-4)]">
              <Button
                variant="outline"
                size="sm"
                disabled={!canExportSceneDiagnostic}
                title={
                  tauriAvailable
                    ? 'Export the recorded 3D scene drop attempts as JSON'
                    : 'Scene diagnostic export is only available in the desktop runtime'
                }
                onClick={handleExportSceneDiagnostic}
              >
                <Icon icon={Download} size="sm" />
                {exportingSceneDiagnostic ? 'Exporting…' : 'Export drop diagnostic'}
              </Button>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
