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
    <div className="settings-external">
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      <div className="settings-external-head">
        <div className="settings-external-head-copy">
          <h2>External Employees</h2>
          <p>
            Branded A2A agents connected to this company. Offisim dispatches tasks over JSON-RPC
            using each agent card.
          </p>
        </div>
        <Button onClick={() => setInstallOpen(true)}>
          <Plug data-icon="inline-start" /> Connect agent
        </Button>
      </div>

      {isLoading && rows.length === 0 && (
        <div className="settings-loading-row">
          <Loader2 data-icon="loading" /> Loading…
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="settings-external-empty">
          <p>No external employees yet</p>
          <span>Connect an A2A endpoint to add a branded external employee.</span>
        </div>
      )}

      <ul className="settings-external-list">
        {rows.map((row) => {
          const brand = lookupExternalBrand(row.brand_key);
          const card = parseAgentCard(row.agent_card_json);
          const isBusy = busyRowId === row.employee_id;
          const isEditing = editingTokenId === row.employee_id;
          return (
            <li key={row.employee_id} className="settings-external-row">
              <div className="settings-external-row-main">
                <img
                  alt={`${brand.displayName} avatar`}
                  src={brand.asset2dUri}
                  className="settings-external-avatar"
                />
                <div className="settings-external-copy">
                  <div className="settings-external-title-row">
                    <p>{row.name}</p>
                    <span className="settings-external-brand">{brand.displayName}</span>
                    <span className="settings-external-role">role: {row.role_slug}</span>
                  </div>
                  <p className="settings-external-url">{row.a2a_url ?? '—'}</p>
                  {card?.name && card.name !== row.name && (
                    <p className="settings-external-card">
                      agent card: {card.name}
                      {card.version ? ` · v${card.version}` : ''}
                    </p>
                  )}
                </div>
                <div className="settings-external-actions">
                  {onEditEmployee && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEditEmployee(row.employee_id)}
                      disabled={isBusy}
                      className="settings-inline-action"
                    >
                      <Pencil data-icon="inline-action" /> Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRefreshCard(row)}
                    disabled={isBusy || !row.a2a_url}
                  >
                    {isBusy ? (
                      <Loader2 data-icon="inline-action-loading" />
                    ) : (
                      <RefreshCw data-icon="inline-action" />
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
                    <Trash2 data-icon="inline-action" /> Disconnect
                  </Button>
                </div>
              </div>

              {isEditing && (
                <div className="settings-external-token-editor">
                  <div>
                    <label htmlFor={`token-${row.employee_id}`}>Bearer token</label>
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
