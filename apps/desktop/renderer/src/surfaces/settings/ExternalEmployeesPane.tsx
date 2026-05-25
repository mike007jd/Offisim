import { IconButton } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { Pencil, Plug, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ExternalEmployeeInstallDialog } from './ExternalEmployeeInstallDialog.js';
import {
  type DiscoveredCard,
  type ExternalEmployee,
  useExternalEmployees,
} from './settings-data.js';

export function ExternalEmployeesPane() {
  const { data: fetched } = useExternalEmployees();
  const [employees, setEmployees] = useState<readonly ExternalEmployee[]>(fetched);
  const [installOpen, setInstallOpen] = useState(false);
  const [tokenEditId, setTokenEditId] = useState<string | null>(null);
  const [justInstalled, setJustInstalled] = useState<string | null>(null);

  function handleInstalled(card: DiscoveredCard) {
    const employee: ExternalEmployee = {
      id: `${card.name}-${Date.now()}`,
      name: card.name,
      brand: card.brand,
      brandGradient: card.brandGradient,
      logoMark: card.logoMark,
      role: card.roleDefault,
      url: card.endpoint,
      cardLabel: `${card.brand} · installed`,
      connected: true,
      installedAt: Date.now(),
    };
    setEmployees((prev) => [employee, ...prev]);
    setJustInstalled(employee.id);
    toast.success(`Connected ${card.name}`);
    window.setTimeout(() => setJustInstalled(null), 1400);
  }

  function disconnect(id: string) {
    setEmployees((prev) => prev.filter((e) => e.id !== id));
    toast.success('External employee disconnected');
  }

  const sorted = [...employees].sort((a, b) => b.installedAt - a.installedAt);

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
                  style={{
                    background: `linear-gradient(135deg, ${employee.brandGradient[0]}, ${employee.brandGradient[1]})`,
                  }}
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
                    label="Edit"
                    size="iconSm"
                    variant="outline"
                    onClick={() => toast.info('Edit URL + role override')}
                  />
                  <IconButton
                    icon={RefreshCw}
                    label="Refresh agent card"
                    size="iconSm"
                    variant="outline"
                    onClick={() => toast.success('Agent card refreshed')}
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
                    onClick={() => disconnect(employee.id)}
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
                      defaultValue=""
                    />
                  </div>
                  <Button
                    size="md"
                    onClick={() => {
                      setTokenEditId(null);
                      toast.success('Token saved');
                    }}
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
