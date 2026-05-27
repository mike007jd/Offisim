import type { Employee } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { AlertTriangle, Bot, CheckCircle2, Lock, ShieldCheck, Wrench } from 'lucide-react';

interface RuntimeBindingOption {
  id: string;
  label: string;
  summary: string;
  status: 'ready' | 'preview' | 'blocked';
  chip: string;
}

const BINDING_OPTIONS: RuntimeBindingOption[] = [
  {
    id: 'inherit',
    label: 'Inherit company default',
    summary: 'Company profile',
    status: 'ready',
    chip: 'default',
  },
  {
    id: 'gateway',
    label: 'Offisim gateway tools',
    summary: 'Files · shell · MCP',
    status: 'ready',
    chip: 'tools',
  },
  {
    id: 'text-preview',
    label: 'Text preview profile',
    summary: 'Reasoning preview',
    status: 'preview',
    chip: 'text-only',
  },
  {
    id: 'tool-isolated-preview',
    label: 'Tool-isolated preview',
    summary: 'Denied-path evidence missing',
    status: 'blocked',
    chip: 'blocked',
  },
  {
    id: 'trusted-desktop',
    label: 'Trusted desktop profile',
    summary: 'Trusted desktop required',
    status: 'blocked',
    chip: 'locked',
  },
  {
    id: 'full-agent',
    label: 'Full-agent profile',
    summary: 'Release proof missing',
    status: 'blocked',
    chip: 'gated',
  },
];

const GATE_BADGES = ['release app', 'denied path', 'rollback', 'credential boundary'];

interface RuntimeTabProps {
  employee: Employee;
}

export function RuntimeTab({ employee }: RuntimeTabProps) {
  const binding = 'inherit';

  if (employee.kind === 'external') {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll">
          <CapsLabel>Execution binding</CapsLabel>
          <div className="off-pers-lock-note">
            <Icon icon={Lock} size="sm" />
            External A2A peer · brand endpoint owned.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <CapsLabel>Execution binding</CapsLabel>
        <div className="off-pers-runtime-head">
          <span className="off-pers-runtime-ic">
            <Icon icon={Bot} size="sm" />
          </span>
          <div>
            <div className="off-pers-runtime-title">Provider gateway</div>
            <div className="off-pers-runtime-sub">{employee.modelLabel} · company default</div>
          </div>
          <span className="off-pers-runtime-ok">
            <Icon icon={ShieldCheck} size="sm" />
            Tools isolated
          </span>
        </div>
        <div className="off-pers-rbind">
          {BINDING_OPTIONS.map((option) => {
            const selected = option.id === binding;
            return (
              <div
                key={option.id}
                data-selected={selected ? 'true' : undefined}
                className={cn('off-pers-rbind-opt', selected && 'is-sel', 'is-dis')}
              >
                <span className="off-pers-rbind-top">
                  <span className="off-pers-rbind-lab">{option.label}</span>
                  <StatusDot status={option.status} />
                </span>
                <span className="off-pers-rbind-des">{option.summary}</span>
                <span className={cn('off-pers-rbind-chip', `is-${option.status}`)}>
                  {option.chip}
                </span>
              </div>
            );
          })}
        </div>
        <div className="off-pers-runtime-note">
          Runtime binding is read-only until employee runtime profiles persist changes.
        </div>
        <div className="off-pers-runtime-gates">
          <span className="off-pers-runtime-gates-label">
            <Icon icon={Wrench} size="sm" />
            Gates
          </span>
          {GATE_BADGES.map((gate) => (
            <span key={gate} className="off-pers-runtime-gate">
              {gate}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: RuntimeBindingOption['status'] }) {
  const icon = status === 'blocked' ? AlertTriangle : CheckCircle2;
  return (
    <span className={cn('off-pers-rbind-status', `is-${status}`)}>
      <Icon icon={icon} size="sm" />
    </span>
  );
}
