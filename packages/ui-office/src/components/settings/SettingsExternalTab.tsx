import {
  type A2AAgentCard,
  type EmployeeRow,
  employeeDeleted,
  employeeUpdated,
} from '@offisim/core/browser';
import { Button, Input, ToastBanner, useToasts } from '@offisim/ui-core';
import { Loader2, Pencil, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  AgentCardDiscoveryError,
  describeDiscoveryError,
  discoverAgentCard,
} from '../../lib/agent-card-discovery';
import { lookupExternalBrand } from '../../lib/brand-registry';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext';
import { ExternalEmployeeInstallDialog } from '../employees/ExternalEmployeeInstallDialog';

function parseAgentCard(raw: string | null): A2AAgentCard | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as A2AAgentCard;
  } catch {
    return null;
  }
}

export interface SettingsExternalTabProps {
  /** Route to Personnel and edit this employee (Profile tab). */
  onEditEmployee?: (employeeId: string) => void;
}

export function SettingsExternalTab({ onEditEmployee }: SettingsExternalTabProps = {}) {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const { toasts, addToast, dismissToast } = useToasts();

  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) {
      setRows([]);
      return;
    }
    setIsLoading(true);
    try {
      const all = await repos.employees.findByCompany(activeCompanyId);
      setRows(all.filter((e) => e.is_external === 1));
    } finally {
      setIsLoading(false);
    }
  }, [repos, activeCompanyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!eventBus) return;
    const unsubscribe = eventBus.on('employee', () => {
      void refresh();
    });
    return unsubscribe;
  }, [eventBus, refresh]);

  const handleRefreshCard = useCallback(
    async (row: EmployeeRow) => {
      if (!repos || !row.a2a_url) return;
      setBusyRowId(row.employee_id);
      try {
        const card = await discoverAgentCard(row.a2a_url, {
          token: row.a2a_token ?? undefined,
          agentId: row.a2a_agent_id ?? undefined,
        });
        await repos.employees.update(row.employee_id, {
          agent_card_json: JSON.stringify(card),
        });
        eventBus?.emit(employeeUpdated(row.company_id, row.employee_id, row.name, row.role_slug));
        addToast(`Agent card refreshed for ${row.name}`, 'success');
      } catch (err) {
        const message =
          err instanceof AgentCardDiscoveryError
            ? describeDiscoveryError(err)
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        addToast(`Refresh failed: ${message}`, 'error');
      } finally {
        setBusyRowId(null);
      }
    },
    [repos, eventBus, addToast],
  );

  const handleStartEditToken = useCallback((row: EmployeeRow) => {
    setEditingTokenId(row.employee_id);
    setTokenDraft(row.a2a_token ?? '');
  }, []);

  const handleCancelEditToken = useCallback(() => {
    setEditingTokenId(null);
    setTokenDraft('');
  }, []);

  const handleSaveToken = useCallback(
    async (row: EmployeeRow) => {
      if (!repos) return;
      setBusyRowId(row.employee_id);
      try {
        const trimmed = tokenDraft.trim();
        await repos.employees.update(row.employee_id, {
          a2a_token: trimmed.length > 0 ? trimmed : null,
        });
        eventBus?.emit(employeeUpdated(row.company_id, row.employee_id, row.name, row.role_slug));
        addToast(`Token updated for ${row.name}`, 'success');
        setEditingTokenId(null);
        setTokenDraft('');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        addToast(`Token update failed: ${message}`, 'error');
      } finally {
        setBusyRowId(null);
      }
    },
    [repos, eventBus, tokenDraft, addToast],
  );

  const handleDisconnect = useCallback(
    async (row: EmployeeRow) => {
      if (!repos) return;
      const confirmed =
        typeof window !== 'undefined'
          ? window.confirm(
              `Disconnect ${row.name}? They will be removed from the office and Offisim will stop dispatching tasks to ${row.a2a_url}.`,
            )
          : true;
      if (!confirmed) return;
      setBusyRowId(row.employee_id);
      try {
        await repos.employees.delete(row.employee_id);
        eventBus?.emit(employeeDeleted(row.company_id, row.employee_id));
        addToast(`Disconnected ${row.name}`, 'info');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        addToast(`Disconnect failed: ${message}`, 'error');
      } finally {
        setBusyRowId(null);
      }
    },
    [repos, eventBus, addToast],
  );

  return (
    <div className="flex flex-col gap-4">
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-1">External Employees</h2>
          <p className="mt-1 text-fs-sm text-ink-3">
            Branded A2A agents connected to this company. Offisim dispatches tasks over JSON-RPC
            using each agent card.
          </p>
        </div>
        <Button onClick={() => setInstallOpen(true)}>
          <Plug className="size-4" /> Connect agent
        </Button>
      </div>

      {isLoading && rows.length === 0 && (
        <div className="flex items-center gap-2 text-fs-sm text-ink-3">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-r-md border border-dashed border-line bg-surface-2 px-6 py-10 text-center">
          <p className="text-fs-sm font-semibold text-ink-1">No external employees yet</p>
          <p className="mt-1 text-fs-meta text-ink-4">
            Connect an A2A endpoint to add a branded external employee.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const brand = lookupExternalBrand(row.brand_key);
          const card = parseAgentCard(row.agent_card_json);
          const isBusy = busyRowId === row.employee_id;
          const isEditing = editingTokenId === row.employee_id;
          return (
            <li key={row.employee_id} className="rounded-r-md border border-line bg-surface-1 p-4">
              <div className="flex items-start gap-3">
                <img
                  alt={`${brand.displayName} avatar`}
                  src={brand.asset2dUri}
                  className="size-11 rounded-r-md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="truncate text-fs-sm font-semibold text-ink-1">{row.name}</p>
                    <span className="rounded-r-pill border border-line-soft bg-surface-2 px-2 py-0.5 text-fs-meta text-ink-3">
                      {brand.displayName}
                    </span>
                    <span className="text-fs-meta text-ink-4">role: {row.role_slug}</span>
                  </div>
                  <p className="mt-1 truncate text-fs-meta text-ink-3">{row.a2a_url ?? '—'}</p>
                  {card?.name && card.name !== row.name && (
                    <p className="mt-0.5 truncate text-fs-meta text-ink-4">
                      agent card: {card.name}
                      {card.version ? ` · v${card.version}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {onEditEmployee && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEditEmployee(row.employee_id)}
                      disabled={isBusy}
                      className="gap-1.5 text-fs-meta"
                    >
                      <Pencil className="size-3" /> Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRefreshCard(row)}
                    disabled={isBusy || !row.a2a_url}
                  >
                    {isBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStartEditToken(row)}
                    disabled={isBusy}
                  >
                    Edit token
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDisconnect(row)}
                    disabled={isBusy}
                  >
                    <Trash2 className="size-3.5" /> Disconnect
                  </Button>
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 flex items-end gap-2 rounded-r-md border border-line bg-surface-2 p-3">
                  <div className="flex-1">
                    <label
                      className="text-fs-meta uppercase tracking-ls-caps text-ink-4"
                      htmlFor={`token-${row.employee_id}`}
                    >
                      Bearer token
                    </label>
                    <Input
                      id={`token-${row.employee_id}`}
                      type="password"
                      value={tokenDraft}
                      onChange={(e) => setTokenDraft(e.target.value)}
                      placeholder="leave empty to clear"
                    />
                  </div>
                  <Button size="sm" onClick={() => handleSaveToken(row)} disabled={isBusy}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleCancelEditToken}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <ExternalEmployeeInstallDialog
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        activeCompanyId={activeCompanyId}
        repos={repos}
        eventBus={eventBus}
        onToast={(message, variant) => addToast(message, variant)}
      />
    </div>
  );
}
