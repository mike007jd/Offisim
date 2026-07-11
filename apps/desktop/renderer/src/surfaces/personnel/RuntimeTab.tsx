import type { PiAgentModelOption } from '@/assistant/composer/usePiAgentModels.js';
import type { Employee } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { THINKING_LEVELS } from '@/runtime/pi-thread-thinking-store.js';
import { Bot, Lock, ShieldCheck } from 'lucide-react';

interface RuntimeTabProps {
  employee: Employee;
  models: PiAgentModelOption[] | undefined;
  modelsLoading: boolean;
  model: string;
  thinkingLevel: string;
  onModelChange: (value: string) => void;
  onThinkingLevelChange: (value: string) => void;
}

/** How this employee runs. Models come only from Pi's available-model projection;
 * persisted bindings that disappear remain visible as invalid but are never sent. */
export function RuntimeTab({
  employee,
  models,
  modelsLoading,
  model,
  thinkingLevel,
  onModelChange,
  onThinkingLevelChange,
}: RuntimeTabProps) {
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

  const valid = models?.some((option) => option.value === model) ?? false;
  const invalid = models !== undefined && Boolean(model) && !valid;
  const selectedModel = invalid || models === undefined ? '' : model;
  const selectedOption = models?.find((option) => option.value === selectedModel);
  const supportsReasoning = selectedOption?.reasoning === true;

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <CapsLabel>Execution binding</CapsLabel>
        <div className="off-pers-runtime-head">
          <span className="off-pers-runtime-ic">
            <Icon icon={Bot} size="sm" />
          </span>
          <div>
            <div className="off-pers-runtime-title">Pi Agent runtime</div>
            <div className="off-pers-runtime-sub">
              {invalid
                ? 'Binding unavailable · inherits conversation model'
                : model || 'Inherits conversation model'}
            </div>
          </div>
          <span className="off-pers-runtime-ok">
            <Icon icon={ShieldCheck} size="sm" />
            Tools isolated
          </span>
        </div>
        <div className="off-pers-runtime-fields">
          <label className="off-pers-runtime-field">
            <span>Model</span>
            <Select
              value={selectedModel}
              onChange={(event) => {
                const next = event.target.value;
                onModelChange(next);
                if (models?.find((option) => option.value === next)?.reasoning !== true) {
                  onThinkingLevelChange('');
                }
              }}
              disabled={modelsLoading}
              options={[
                {
                  value: '',
                  label: modelsLoading ? 'Loading Pi models…' : 'Inherit conversation model',
                },
                ...(models ?? []).map((option) => ({
                  value: option.value,
                  label: `${option.provider} · ${option.name}`,
                })),
              ]}
            />
          </label>
          <label className="off-pers-runtime-field">
            <span>Thinking level</span>
            <Select
              value={model && !invalid ? thinkingLevel : ''}
              onChange={(event) => onThinkingLevelChange(event.target.value)}
              disabled={!model || invalid || !supportsReasoning}
              options={[
                { value: '', label: 'Use conversation level' },
                ...THINKING_LEVELS.map((level) => ({ value: level, label: level })),
              ]}
            />
          </label>
        </div>
        {invalid ? (
          <p className="off-pers-runtime-warning">
            Saved model “{model}” is no longer available in Pi. It is not sent; this employee
            inherits the conversation model until you choose another.
          </p>
        ) : null}
      </div>
    </div>
  );
}
