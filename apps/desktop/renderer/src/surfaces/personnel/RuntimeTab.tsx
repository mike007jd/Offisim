import type { Employee } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { Lock, Save } from 'lucide-react';
import { useState } from 'react';

interface RuntimeBindingOption {
  id: string;
  label: string;
  description: string;
  /** Sub-line: profile id (mono), unavailable reason (warn), or requirement. */
  profile?: string;
  unavailable?: string;
  requires?: string;
  disabled?: boolean;
}

const BINDING_OPTIONS: RuntimeBindingOption[] = [
  {
    id: 'inherit',
    label: 'Inherit company default',
    description: 'Use the company capability profile.',
  },
  {
    id: 'gateway',
    label: 'Offisim gateway tools',
    description: 'Default harness with Offisim file, shell, MCP, and evidence paths.',
  },
  {
    id: 'claude-text',
    label: 'Claude text engine',
    description: 'Preview text/reasoning only; no Offisim local tools.',
    profile: 'claude · text-only · preview · unverified',
  },
  {
    id: 'codex-text',
    label: 'Codex text engine',
    description: 'Preview text/reasoning only; no Offisim local tools.',
    unavailable:
      'Full-agent target unavailable: codex-engine:sdk-native-full-power · missing release-app / denied-path',
  },
  {
    id: 'openai-text',
    label: 'OpenAI text engine',
    description: 'Preview text/reasoning only; no Offisim local tools.',
    requires: 'Requires trusted desktop runtime',
    disabled: true,
  },
  {
    id: 'codex-full',
    label: 'Codex full-agent',
    description: 'Blocked until selected-model release evidence passes.',
    unavailable: 'Unavailable: release-app / cancellation',
  },
];

interface RuntimeTabProps {
  employee: Employee;
}

export function RuntimeTab({ employee }: RuntimeTabProps) {
  const [binding, setBinding] = useState('inherit');
  const [initialBinding] = useState('inherit');
  const isDirty = binding !== initialBinding;

  if (employee.kind === 'external') {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll">
          <CapsLabel>Execution binding</CapsLabel>
          <div className="off-pers-lock-note">
            <Icon icon={Lock} size="sm" />
            External A2A peer — routing handled by brand endpoint.
          </div>
          <p className="off-field-hint">
            A2A discovery + dispatch is owned by the remote agent card; no local binding selection.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <CapsLabel>Execution binding</CapsLabel>
        <div className="off-pers-rbind">
          {BINDING_OPTIONS.map((option) => {
            const selected = option.id === binding;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                disabled={option.disabled}
                className={cn(
                  'off-pers-rbind-opt off-focusable',
                  selected && 'is-sel',
                  option.disabled && 'is-dis',
                )}
                onClick={() => !option.disabled && setBinding(option.id)}
              >
                <span className="off-pers-rbind-lab">{option.label}</span>
                <span className="off-pers-rbind-des">{option.description}</span>
                {option.profile ? (
                  <span className="off-pers-rbind-prof">{option.profile}</span>
                ) : null}
                {option.unavailable ? (
                  <span className="off-pers-rbind-full">{option.unavailable}</span>
                ) : null}
                {option.requires ? (
                  <span className="off-pers-rbind-req">{option.requires}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="off-pers-rbind-resolved">
          Resolved: <b>Provider gateway (from company default)</b>
        </p>
        <div className="off-pers-rbind-disc">
          Text-only preview · SDK transport is model access, not a full-agent route. Gateway-bridged
          tools and SDK-native full-agent profiles become selectable only after deterministic,
          benchmark, trusted-host, release app, denied-path, cancellation, rollback, sandbox, and
          credential-boundary evidence passes.
        </div>
      </div>
      {isDirty ? (
        <div className="off-pers-savebar">
          <span className="off-pers-savebar-left" />
          <Button size="sm" onClick={() => setBinding(initialBinding)}>
            <Icon icon={Save} size="sm" />
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}
