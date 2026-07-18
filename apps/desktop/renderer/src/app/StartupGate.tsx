import { App } from '@/App.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  type StartupDiagnosticExport,
  type StartupStatus,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { Archive, DatabaseZap, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

function SafeModeSurface({ status }: { status: StartupStatus }) {
  const [exporting, setExporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [diagnostic, setDiagnostic] = useState<StartupDiagnosticExport | null>(null);

  async function exportDiagnostics() {
    setExporting(true);
    try {
      const result = await invokeCommand('startup_export_diagnostics');
      setDiagnostic(result);
      toast.success('Diagnostic bundle exported', { description: result.displayPath });
    } catch (error) {
      toast.error('Could not export diagnostics', { description: String(error) });
    } finally {
      setExporting(false);
    }
  }

  async function resetLocalData() {
    setResetting(true);
    try {
      await invokeCommand('startup_reset_local_data');
    } catch (error) {
      setResetting(false);
      toast.error('Could not reset local data', { description: String(error) });
    }
  }

  return (
    <main className="off-safe-mode">
      <section className="off-safe-mode-card" aria-labelledby="off-safe-mode-title">
        <div className="off-safe-mode-icon" aria-hidden="true">
          <ShieldAlert />
        </div>
        <div className="off-safe-mode-kicker">Startup safe mode</div>
        <h1 id="off-safe-mode-title">Offisim opened in recovery mode</h1>
        <p className="off-safe-mode-summary">
          {status.summary ??
            'Offisim could not finish startup. Your projects and native agent data were not changed.'}
        </p>

        <dl className="off-safe-mode-meta">
          <div>
            <dt>Stage</dt>
            <dd>{status.stage ?? 'startup'}</dd>
          </div>
          <div>
            <dt>Incident</dt>
            <dd>{status.incidentId ?? 'unavailable'}</dd>
          </div>
        </dl>

        <div className="off-safe-mode-actions">
          <Button size="lg" onClick={() => void exportDiagnostics()} disabled={exporting}>
            <Archive size={16} />
            {exporting ? 'Exporting…' : 'Export diagnostic bundle'}
          </Button>
          <Button
            size="lg"
            variant="outlineDanger"
            onClick={() => setConfirmReset(true)}
            disabled={resetting}
          >
            <DatabaseZap size={16} />
            Reset local data and restart
          </Button>
        </div>

        {diagnostic ? (
          <p className="off-safe-mode-exported">
            Exported <strong>{diagnostic.fileName}</strong> to {diagnostic.displayPath}
          </p>
        ) : (
          <p className="off-safe-mode-privacy">
            Diagnostics include sanitized startup logs, environment details, and database metadata
            only—never database rows, conversations, project files, native agent data, or
            credentials.
          </p>
        )}

        {confirmReset ? (
          <div className="off-safe-mode-confirm" role="alert">
            <div>
              <strong>Delete all Offisim local data?</strong>
              <p>
                This removes ~/.offisim and cannot be undone. Export diagnostics first if you need
                them. Native agent homes are outside this folder and stay untouched.
              </p>
            </div>
            <div className="off-safe-mode-confirm-actions">
              <Button variant="outline" onClick={() => setConfirmReset(false)} disabled={resetting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void resetLocalData()}
                disabled={resetting}
              >
                {resetting ? 'Resetting…' : 'Reset and restart'}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function StartupGate() {
  const [status, setStatus] = useState<StartupStatus | null>(null);

  useEffect(() => {
    let active = true;
    void invokeCommand('startup_status')
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch((error) => {
        // Browser-only renderer development has no Tauri IPC. A desktop IPC
        // failure must stay on the recovery surface instead of mounting the
        // database-backed app after startup truth became unavailable.
        if (active) {
          const isDesktop = '__TAURI_INTERNALS__' in window;
          setStatus(
            isDesktop
              ? {
                  mode: 'safe',
                  incidentId: 'startup-ipc-unavailable',
                  stage: 'startup status',
                  summary: `Offisim could not read startup status: ${String(error)}`,
                  occurredAtUnixMs: Date.now(),
                }
              : {
                  mode: 'normal',
                  incidentId: null,
                  stage: null,
                  summary: null,
                  occurredAtUnixMs: null,
                },
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (!status) {
    return (
      <main className="off-safe-mode is-loading" aria-label="Starting Offisim">
        <div className="off-safe-mode-loader animate-spin" />
        <span>Starting Offisim…</span>
      </main>
    );
  }
  return status.mode === 'safe' ? <SafeModeSurface status={status} /> : <App />;
}
