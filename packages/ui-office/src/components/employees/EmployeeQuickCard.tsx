import type { EmployeeRow, EmployeeUpdate } from '@offisim/core/browser';
import { parseEmployeeConfig, parseEmployeePersona } from '@offisim/shared-types';
import { Button, Input, Textarea } from '@offisim/ui-core';
import { useCallback, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePersona(raw: string | null): { expertise: string; style: string } {
  const persona = parseEmployeePersona(raw);
  return {
    expertise: persona.expertise ?? '',
    style: persona.style ?? '',
  };
}

function parseConfig(raw: string | null): { modelPreference: string; temperature: number } {
  const config = parseEmployeeConfig(raw);
  return {
    modelPreference: config.modelPreference ?? '',
    temperature: config.temperature ?? 0.7,
  };
}

/** Map employee enabled value (0|1) + agent state to a display label + tone. */
function statusBadge(enabled: number, agentState?: string): { label: string; tone: string } {
  if (!enabled) return { label: 'disabled', tone: 'disabled' };
  switch (agentState) {
    case 'working':
      return { label: 'working', tone: 'working' };
    case 'blocked':
      return { label: 'blocked', tone: 'blocked' };
    default:
      return { label: 'idle', tone: 'idle' };
  }
}

// ---------------------------------------------------------------------------
// Inline-edit field
// ---------------------------------------------------------------------------

interface InlineEditProps {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  className?: string;
  /** Render as a textarea instead of an input for multiline fields. */
  multiline?: boolean;
}

function InlineEdit({
  value,
  onSave,
  placeholder,
  className = '',
  multiline = false,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const startEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
    // Focus after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft.trim() !== value) {
      onSave(draft.trim());
    }
  }, [draft, value, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        setEditing(false);
        setDraft(value);
      }
    },
    [commit, multiline, value],
  );

  if (editing) {
    const shared = {
      ref: inputRef as React.Ref<HTMLInputElement & HTMLTextAreaElement>,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: handleKeyDown,
      className: `employee-quick-inline-field ${className}`,
      placeholder,
    };
    if (multiline) {
      return (
        <Textarea
          {...shared}
          rows={2}
          className={`${shared.className} employee-quick-inline-area`}
        />
      );
    }
    return <Input {...shared} />;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={startEdit}
      aria-label="Edit field"
      className={`employee-quick-inline-button ${className}`}
    >
      {value || <span data-slot="placeholder">{placeholder}</span>}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// EmployeeQuickCard
// ---------------------------------------------------------------------------

export interface EmployeeQuickCardProps {
  employee: EmployeeRow;
  /** Current agent runtime state: 'idle' | 'working' | 'blocked' */
  agentState?: string;
  onUpdate: (id: string, patch: EmployeeUpdate) => Promise<void>;
}

export function EmployeeQuickCard({ employee, agentState, onUpdate }: EmployeeQuickCardProps) {
  const persona = parsePersona(employee.persona_json);
  const config = parseConfig(employee.config_json);
  const { label: statusLabel, tone: statusTone } = statusBadge(employee.enabled, agentState);

  // Helper: save a persona field
  const savePersField = useCallback(
    (field: 'expertise' | 'style', next: string) => {
      const existing = parseEmployeePersona(employee.persona_json);
      onUpdate(employee.employee_id, {
        persona_json: JSON.stringify({ ...existing, [field]: next }),
      });
    },
    [employee.employee_id, employee.persona_json, onUpdate],
  );

  return (
    <div className="employee-quick-card">
      {/* Header row: name + status badge */}
      <div className="employee-quick-header">
        <div>
          <InlineEdit
            value={employee.name}
            placeholder="Name"
            className="employee-quick-name"
            onSave={(next) => onUpdate(employee.employee_id, { name: next })}
          />
        </div>
        <span className="employee-quick-status" data-tone={statusTone}>
          {statusLabel}
        </span>
      </div>

      {/* Role badge */}
      <div className="employee-quick-role">
        <span>{employee.role_slug}</span>
      </div>

      {/* Expertise */}
      <div className="employee-quick-field">
        <p>Expertise</p>
        <InlineEdit
          value={persona.expertise}
          placeholder="e.g. React, Node.js"
          className="employee-quick-body"
          multiline
          onSave={(next) => savePersField('expertise', next)}
        />
      </div>

      {/* Style */}
      <div className="employee-quick-field">
        <p>Style</p>
        <InlineEdit
          value={persona.style}
          placeholder="e.g. detail-oriented"
          className="employee-quick-body"
          onSave={(next) => savePersField('style', next)}
        />
      </div>

      {/* Model + temperature footer */}
      <div className="employee-quick-footer">
        <span data-slot="model" title={config.modelPreference || '跟随统一设置'}>
          {config.modelPreference || <em>跟随统一设置</em>}
        </span>
        <span data-slot="temperature">T {config.temperature.toFixed(1)}</span>
      </div>
    </div>
  );
}
