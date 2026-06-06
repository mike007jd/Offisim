import { type SceneDropDiagnostic, useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import {
  CapsLabel,
  CardBlock,
  FieldRow,
  SegmentedControl,
  Select,
} from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Download, FolderOpen, Package, Zap } from 'lucide-react';
import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
  DEFAULT_RUNTIME_OPTIONS,
  ENABLED_OPTIONS,
  EXECUTION_MODE_OPTIONS,
  type RuntimeFormValues,
} from './settings-data.js';

type EmployeeRuntimeValue = 'gateway' | 'claude' | 'codex';

const EXECUTION_MODE_COPY: Record<string, string> = {
  plan: 'Draft a plan before work starts.',
  human_loop: 'Ask before sensitive or high-impact actions.',
  direct: 'Run normal tasks without extra ceremony.',
  yolo: 'Use maximum autonomy and minimal interruption.',
};

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
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<RuntimeVaultStatus>('runtime_vault_status');
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

interface RuntimePaneProps {
  form: UseFormReturn<RuntimeFormValues>;
  saved: boolean;
}

export function RuntimePane({ form, saved }: RuntimePaneProps) {
  const defaultRuntime = form.watch('defaultRuntime') as EmployeeRuntimeValue;
  const executionMode = form.watch('executionMode');
  const toolSearch = form.watch('toolSearch');
  const gitAutoCommit = form.watch('gitAutoCommit');
  const sceneDropDiagnostics = useUiState((s) => s.sceneDropDiagnostics);
  const errors = form.formState.errors;
  const [openingVault, setOpeningVault] = useState(false);
  const [exportingVaultZip, setExportingVaultZip] = useState(false);
  const [exportingSceneDiagnostic, setExportingSceneDiagnostic] = useState(false);
  const [lastVaultExport, setLastVaultExport] = useState<LocalExportResult | null>(null);
  const [lastSceneDiagnostic, setLastSceneDiagnostic] = useState<LocalExportResult | null>(null);
  const vaultQuery = useQuery({
    queryKey: ['settings', 'runtime-vault-status'],
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
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_runtime_vault_folder');
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
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<LocalExportResult>('export_runtime_vault_zip');
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
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<LocalExportResult>('export_scene_drop_diagnostic', {
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
        <div className="off-set-panetitle">
          Runtime
          {saved ? (
            <span className="off-set-saved-flash">
              <Icon icon={Check} size="sm" />
              Saved
            </span>
          ) : null}
        </div>
        <div className="off-set-panedesc">How employees plan, ask, and execute work.</div>
      </div>

      {/* General — execution behavior */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>How employees run</CapsLabel>
        </div>
        <div className="off-set-sec-hint mb-[var(--off-sp-3)] mt-0">
          Choose the default autonomy level for employee runs.
        </div>
        <CardBlock>
          <div className="off-set-grid-3">
            <FieldRow label="Run mode">
              {({ id }) => (
                <Select
                  id={id}
                  options={EXECUTION_MODE_OPTIONS}
                  name="executionMode"
                  value={executionMode}
                  onChange={(event) =>
                    form.setValue('executionMode', event.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              )}
            </FieldRow>
            <FieldRow label="Tool discovery">
              {({ id }) => (
                <Select
                  id={id}
                  options={ENABLED_OPTIONS}
                  name="toolSearch"
                  value={toolSearch}
                  onChange={(event) =>
                    form.setValue('toolSearch', event.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              )}
            </FieldRow>
            <FieldRow label="Auto-commit">
              {({ id }) => (
                <Select
                  id={id}
                  options={ENABLED_OPTIONS}
                  name="gitAutoCommit"
                  value={gitAutoCommit}
                  onChange={(event) =>
                    form.setValue('gitAutoCommit', event.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              )}
            </FieldRow>
          </div>
          <div className="off-set-mode-copy">
            {EXECUTION_MODE_COPY[executionMode] ?? EXECUTION_MODE_COPY.direct}
          </div>
          <div className="off-field mt-[var(--off-sp-6)]">
            <span className="off-field-label">Default employee runtime</span>
            <SegmentedControl<EmployeeRuntimeValue>
              wrap
              value={defaultRuntime}
              onChange={(value) => {
                form.setValue('defaultRuntime', value, { shouldDirty: true });
                form.setValue('runtimeBinding', value, { shouldDirty: true });
              }}
              ariaLabel="Default employee runtime"
              options={[
                { value: 'gateway', label: 'Desktop lane', icon: <Icon icon={Zap} size="sm" /> },
                { value: 'claude', label: 'Verified driver' },
                { value: 'codex', label: 'Isolated driver' },
              ]}
            />
            <div className="off-set-rbc-resolved">
              Resolved:{' '}
              <b>
                {DEFAULT_RUNTIME_OPTIONS.find((o) => o.value === defaultRuntime)?.label ??
                  'Desktop lane'}
              </b>
            </div>
            <span className="off-field-hint">
              The execution lane employees use unless a company override applies.
            </span>
          </div>
        </CardBlock>
      </section>

      {/* Advanced */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Advanced</CapsLabel>
        </div>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Runtime wiring status
          </summary>
          <div className="off-set-disclosure-body">
            <div className="off-set-sec-hint mb-[var(--off-sp-3)] mt-0">
              Preferences are saved locally. This build still executes in Offisim's trusted desktop
              lane while the full policy wiring lands.
            </div>
          </div>
        </details>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Conversation memory &amp; summarization
          </summary>
          <div className="off-set-disclosure-body">
            <div className="off-set-subhead">Memory</div>
            <div className="off-set-grid-4">
              <FieldRow label="Enabled">
                {({ id }) => (
                  <Select id={id} options={ENABLED_OPTIONS} {...form.register('memoryEnabled')} />
                )}
              </FieldRow>
              <FieldRow label="Prompt injection">
                {({ id }) => (
                  <Select id={id} options={ENABLED_OPTIONS} {...form.register('memoryInjection')} />
                )}
              </FieldRow>
              <FieldRow
                label="Max facts"
                hint={errors.memoryMaxFacts?.message}
                warn={!!errors.memoryMaxFacts}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    {...form.register('memoryMaxFacts', { valueAsNumber: true })}
                  />
                )}
              </FieldRow>
              <FieldRow
                label="Confidence"
                hint={errors.memoryConfidence?.message}
                warn={!!errors.memoryConfidence}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    step="0.1"
                    {...form.register('memoryConfidence', { valueAsNumber: true })}
                  />
                )}
              </FieldRow>
            </div>
            <div className="off-set-subhead mt-[var(--off-sp-6)]">Summarization</div>
            <div className="off-set-sec-hint mb-[var(--off-sp-3)]">
              Auto-compress long conversations.
            </div>
            <div className="off-set-grid-3">
              <FieldRow label="Enabled">
                {({ id }) => (
                  <Select
                    id={id}
                    options={ENABLED_OPTIONS}
                    {...form.register('summarizationEnabled')}
                  />
                )}
              </FieldRow>
              <FieldRow
                label="Trigger tokens"
                hint={errors.summarizationTrigger?.message}
                warn={!!errors.summarizationTrigger}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    {...form.register('summarizationTrigger', { valueAsNumber: true })}
                  />
                )}
              </FieldRow>
              <FieldRow
                label="Keep recent"
                hint={errors.summarizationKeepRecent?.message}
                warn={!!errors.summarizationKeepRecent}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    {...form.register('summarizationKeepRecent', { valueAsNumber: true })}
                  />
                )}
              </FieldRow>
            </div>
          </div>
        </details>

        <details className="off-set-disclosure">
          <summary>
            <span className="off-set-chev">
              <Icon icon={ChevronRight} size="sm" />
            </span>
            Local vault
          </summary>
          <div className="off-set-disclosure-body">
            <CardBlock className="off-set-vault-card">
              <div className="off-set-vault-head">
                <span className="off-set-vault-ico">
                  <Icon icon={FolderOpen} size="sm" />
                </span>
                <div>
                  <div className="off-set-vault-title">
                    Local vault <span className="off-set-mode-tag">Desktop</span>
                  </div>
                  <div className="off-set-vault-sub">
                    Employee files are mirrored to a local folder.
                  </div>
                </div>
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
            </CardBlock>
            <CardBlock className="off-set-vault-card">
              <div className="off-set-vault-head">
                <span className="off-set-vault-ico">
                  <Icon icon={FolderOpen} size="sm" />
                </span>
                <div>
                  <div className="off-set-vault-title">
                    Vault snapshot <span className="off-set-mode-tag">Desktop</span>
                  </div>
                  <div className="off-set-vault-sub">
                    Export a zip snapshot of the current vault for backup or handoff.
                  </div>
                </div>
              </div>
              <div className="off-set-vault-status">
                Exports write to Offisim's app-local exports folder with the current employee vault
                files.
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
