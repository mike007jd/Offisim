import type { RoleSlug } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HIREABLE_ROLES } from '../../lib/roles';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StepFormValues {
  label: string;
  roleSlug: RoleSlug;
  instruction: string;
}

export interface SopAddStepPopoverProps {
  /** Screen-space position for the popover */
  position: { x: number; y: number };
  /** Pre-filled values for edit mode */
  initialValues?: StepFormValues;
  /** Submit label — "Add" for create, "Save" for edit */
  submitLabel?: string;
  onSubmit: (values: StepFormValues) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// SopAddStepPopover
// ---------------------------------------------------------------------------

export function SopAddStepPopover({
  position,
  initialValues,
  submitLabel = 'Add',
  onSubmit,
  onCancel,
}: SopAddStepPopoverProps) {
  const [label, setLabel] = useState(initialValues?.label ?? '');
  const [roleSlug, setRoleSlug] = useState<RoleSlug>(
    initialValues?.roleSlug ?? ('developer' as RoleSlug),
  );
  const [instruction, setInstruction] = useState(initialValues?.instruction ?? '');

  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Auto-focus label input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click outside → dismiss
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [onCancel]);

  // Escape → dismiss
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!label.trim()) return;
      onSubmit({ label: label.trim(), roleSlug, instruction: instruction.trim() });
    },
    [label, roleSlug, instruction, onSubmit],
  );

  // Clamp position so popover doesn't go off-screen
  const style: React.CSSProperties = {
    position: 'absolute',
    left: Math.min(position.x, window.innerWidth - 300),
    top: Math.min(position.y, window.innerHeight - 280),
    zIndex: 50,
  };

  return (
    <div
      ref={popoverRef}
      style={style}
      className="w-[280px] rounded-lg border border-white/10 bg-slate-800/95 p-3 shadow-xl backdrop-blur-sm"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          ref={inputRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Step label..."
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
        />
        <select
          value={roleSlug}
          onChange={(e) => setRoleSlug(e.target.value as RoleSlug)}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/50"
        >
          {HIREABLE_ROLES.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.label}
            </option>
          ))}
        </select>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Instruction (optional)..."
          rows={2}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 placeholder:text-slate-500 resize-none focus:outline-none focus:border-cyan-500/50"
        />
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!label.trim()}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
