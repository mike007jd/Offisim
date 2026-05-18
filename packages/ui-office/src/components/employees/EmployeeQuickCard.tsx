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

/** Map employee enabled value (0|1) + agent state to a display label + colour. */
function statusBadge(enabled: number, agentState?: string): { label: string; cls: string } {
  if (!enabled) return { label: 'disabled', cls: 'bg-surface-muted text-text-muted' };
  switch (agentState) {
    case 'working':
      return { label: 'working', cls: 'bg-kelp-green/20 text-kelp-green' };
    case 'blocked':
      return { label: 'blocked', cls: 'bg-lobster-red/20 text-lobster-red' };
    default:
      return { label: 'idle', cls: 'bg-ocean-light/40 text-shell' };
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
      className: `w-full bg-white text-sm text-ink focus-visible:ring-lobster-red/40 ${className}`,
      placeholder,
    };
    if (multiline) {
      return <Textarea {...shared} rows={2} className={`${shared.className} resize-none`} />;
    }
    return <Input {...shared} />;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={startEdit}
      aria-label="Edit field"
      className={`h-auto w-full cursor-text justify-start whitespace-normal rounded px-1.5 py-0.5 text-left transition-colors hover:bg-ocean-light/20 ${className}`}
    >
      {value || <span className="text-shell/40 italic">{placeholder}</span>}
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
  const { label: statusLabel, cls: statusCls } = statusBadge(employee.enabled, agentState);

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
    <div className="flex flex-col gap-2 bg-white border border-ocean-light rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow w-full">
      {/* Header row: name + status badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={employee.name}
            placeholder="Name"
            className="font-semibold text-sm text-ink"
            onSave={(next) => onUpdate(employee.employee_id, { name: next })}
          />
        </div>
        <span
          className={`shrink-0 text-caption font-medium px-1.5 py-0.5 rounded-full ${statusCls}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Role badge */}
      <div>
        <span className="inline-block text-caption font-mono bg-ocean-light/40 text-shell rounded px-1.5 py-0.5">
          {employee.role_slug}
        </span>
      </div>

      {/* Expertise */}
      <div>
        <p className="text-caption text-shell/60 uppercase tracking-wider mb-0.5">Expertise</p>
        <InlineEdit
          value={persona.expertise}
          placeholder="e.g. React, Node.js"
          className="text-xs text-ink/80"
          multiline
          onSave={(next) => savePersField('expertise', next)}
        />
      </div>

      {/* Style */}
      <div>
        <p className="text-caption text-shell/60 uppercase tracking-wider mb-0.5">Style</p>
        <InlineEdit
          value={persona.style}
          placeholder="e.g. detail-oriented"
          className="text-xs text-ink/80"
          onSave={(next) => savePersField('style', next)}
        />
      </div>

      {/* Model + temperature footer */}
      <div className="mt-auto pt-2 border-t border-ocean-light/60 flex items-center justify-between gap-2">
        <span
          className="max-w-employee-quick-meta truncate text-caption text-shell/70"
          title={config.modelPreference || '跟随统一设置'}
        >
          {config.modelPreference || <em>跟随统一设置</em>}
        </span>
        <span className="text-caption font-mono text-shell/70 shrink-0">
          T {config.temperature.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
