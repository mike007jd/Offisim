import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { IconButton } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import type { RoleSlug } from '@offisim/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plug, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { toast } from 'sonner';
import { ExternalEmployeeInstallDialog } from './ExternalEmployeeInstallDialog.js';
import {
  type DiscoveredCard,
  type ExternalEmployee,
  discoverAgentCard,
  useExternalEmployees,
} from './settings-data.js';

function externalRoleSlug(role: string): RoleSlug {
  const normalized = role.toLowerCase();
  if (normalized.includes('research')) return 'researcher';
  if (normalized.includes('analyst')) return 'analyst';
  if (normalized.includes('ops') || normalized.includes('devops')) return 'devops';
  if (normalized.includes('code') || normalized.includes('engineer')) return 'engineer';
  if (normalized.includes('qa') || normalized.includes('test')) return 'qa';
  if (normalized.includes('design')) return 'designer';
  return 'researcher';
}

export function ExternalEmployeesPane() {
  const companyId = useUiState((s) => s.companyId);
  const setSurface = useUiState((s) => s.setSurface);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const queryClient = useQueryClient();
  const { data: fetched = [] } = useExternalEmployees(companyId);
  const [installOpen, setInstallOpen] = useState(false);
  const [tokenEditId, setTokenEditId] = useState<string | null>(null);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [justInstalled, setJustInstalled] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function invalidateExternalEmployees() {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'external-employees', companyId] });
    void queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
  }

  async function handleInstalled(card: DiscoveredCard) {
    const repos = await reposOrNull();
    if (!repos) {
      throw new Error('External employee install requires the release desktop app.');
    }
    const { employee_id } = await repos.employees.create({
      company_id: companyId,
      name: card.name,
      role_slug: externalRoleSlug(card.roleDefault),
      source_asset_id: null,
      source_package_id: null,
      persona_json: JSON.stringify({ freeform: card.description }),
      config_json: JSON.stringify({
        runtime: 'a2a',
        interfaces: card.interfaces,
        endpoint: card.endpoint,
      }),
      is_external: true,
      a2a_url: card.endpoint,
      a2a_token: null,
      a2a_agent_id: card.name,
      brand_key: card.brand,
      agent_card_json: JSON.stringify(card),
    });
    setJustInstalled(employee_id);
    invalidateExternalEmployees();
    toast.success(`Connected ${card.name}`);
    window.setTimeout(() => setJustInstalled(null), 1400);
  }

  async function disconnect(employee: ExternalEmployee) {
    if (busyId === employee.id) return;
    setBusyId(employee.id);
    try {
      const repos = await reposOrNull();
      if (!repos) {
        toast.error('External employee changes require the release desktop app.');
        return;
      }
      await repos.employees.delete(employee.id);
      invalidateExternalEmployees();
      toast.success('External employee disconnected');
    } finally {
      setBusyId(null);
    }
  }

  async function refreshAgentCard(employee: ExternalEmployee) {
    setRefreshingId(employee.id);
    try {
      const card = await discoverAgentCard(employee.cardUrl || employee.url);
      const repos = await reposOrNull();
      if (!repos) {
        throw new Error('External employee changes require the release desktop app.');
      }
      await repos.employees.update(employee.id, {
        name: card.name,
        role_slug: externalRoleSlug(card.roleDefault),
        config_json: JSON.stringify({
          runtime: 'a2a',
          interfaces: card.interfaces,
          endpoint: card.endpoint,
        }),
        a2a_url: card.endpoint,
        a2a_agent_id: card.name,
        brand_key: card.brand,
        agent_card_json: JSON.stringify(card),
      });
      invalidateExternalEmployees();
      toast.success(`Refreshed ${card.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not refresh agent card');
    } finally {
      setRefreshingId(null);
    }
  }

  async function saveToken(employee: ExternalEmployee) {
    if (busyId === employee.id) return;
    setBusyId(employee.id);
    try {
      const token = tokenDrafts[employee.id]?.trim() ?? '';
      const repos = await reposOrNull();
      if (!repos) {
        toast.error('External employee token changes require the release desktop app.');
        return;
      }
      await repos.employees.update(employee.id, { a2a_token: token || null });
      invalidateExternalEmployees();
      toast.success('Token saved');
      setTokenEditId(null);
      setTokenDrafts((prev) => {
        const next = { ...prev };
        delete next[employee.id];
        return next;
      });
    } finally {
      setBusyId(null);
    }
  }

  function openPersonnelProfile(employee: ExternalEmployee) {
    selectEmployee(employee.id);
    setSurface('personnel');
  }

  const sorted = [...fetched].sort((a, b) => b.installedAt - a.installedAt);

  return (
    <div className="off-set-pane">
      <div className="off-set-ext-head">
        <div>
          <div className="off-set-panetitle">External Employees</div>
          <div className="off-set-panedesc">
            Branded A2A agents connected to this company. Offisim dispatches tasks over JSON-RPC
            using each agent card.
          </div>
        </div>
        {sorted.length > 0 ? (
          <Button size="md" onClick={() => setInstallOpen(true)}>
            <Icon icon={Plug} size="sm" />
            Connect agent
          </Button>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <div className="off-set-ext-empty">
          <div className="off-set-ee-i">
            <Icon icon={Users} size="md" />
          </div>
          <div className="off-set-ee-t">No external employees connected</div>
          <div className="off-set-ee-d">
            Paste an A2A agent card URL to add a branded external employee.
            <br />
            OpenClaw, Hermes, Codex and custom A2A endpoints are supported.
          </div>
          <Button size="md" className="mt-[var(--off-sp-5)]" onClick={() => setInstallOpen(true)}>
            <Icon icon={Plus} size="sm" />
            Install external employee
          </Button>
        </div>
      ) : (
        <div className="off-set-ext-list">
          {sorted.map((employee) => (
            <div
              key={employee.id}
              className={`off-set-ext-row${justInstalled === employee.id ? ' is-fresh' : ''}`}
            >
              <div className="off-set-ext-main">
                <div
                  className="off-set-ext-logo"
                  style={
                    {
                      '--off-ext-brand-a': employee.brandGradient[0],
                      '--off-ext-brand-b': employee.brandGradient[1],
                    } as CSSProperties
                  }
                >
                  {employee.logoMark}
                </div>
                <div className="off-set-ext-info">
                  <div className="off-set-ext-name-row">
                    <span className="off-set-ext-name">{employee.name}</span>
                    <span className="off-set-ext-brand">{employee.brand}</span>
                    <span className="off-set-ext-role">role: {employee.role}</span>
                  </div>
                  <div className="off-set-ext-url">{employee.url}</div>
                  <div className="off-set-ext-card-meta">agent card: {employee.cardLabel}</div>
                </div>
                <div className="off-set-ext-actions">
                  <IconButton
                    icon={Pencil}
                    label="Edit profile in Personnel"
                    size="iconSm"
                    variant="outline"
                    onClick={() => openPersonnelProfile(employee)}
                  />
                  <IconButton
                    icon={RefreshCw}
                    label="Refresh agent card"
                    size="iconSm"
                    variant="outline"
                    disabled={refreshingId === employee.id}
                    onClick={() => void refreshAgentCard(employee)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setTokenEditId((prev) => (prev === employee.id ? null : employee.id))
                    }
                  >
                    Edit token
                  </Button>
                  <IconButton
                    icon={Trash2}
                    label="Disconnect"
                    size="iconSm"
                    variant="outline"
                    className="off-set-micro-danger"
                    disabled={busyId === employee.id}
                    onClick={() => void disconnect(employee)}
                  />
                </div>
              </div>
              {tokenEditId === employee.id ? (
                <div className="off-set-ext-token">
                  <div className="off-field flex-1">
                    <span className="off-field-label">Bearer token</span>
                    <Input
                      type="password"
                      className="off-mono"
                      placeholder="leave empty to clear"
                      value={tokenDrafts[employee.id] ?? ''}
                      onChange={(event) =>
                        setTokenDrafts((prev) => ({ ...prev, [employee.id]: event.target.value }))
                      }
                    />
                  </div>
                  <Button
                    size="md"
                    disabled={busyId === employee.id}
                    onClick={() => void saveToken(employee)}
                  >
                    Save
                  </Button>
                  <Button variant="outline" size="md" onClick={() => setTokenEditId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <ExternalEmployeeInstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstalled={handleInstalled}
      />
    </div>
  );
}
