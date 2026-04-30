import type { RoleSlug } from '@offisim/shared-types';
import {
  Button,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@offisim/ui-core';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { HIREABLE_ROLES } from '../../lib/roles';

export interface StepFormValues {
  label: string;
  roleSlug: RoleSlug;
  instruction: string;
}

export interface SopAddStepPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  anchor?: ReactNode;
  initialValues?: StepFormValues;
  submitLabel?: string;
  stackId?: string;
  onSubmit: (values: StepFormValues) => void;
}

export function SopAddStepPopover({
  open,
  onOpenChange,
  trigger,
  anchor,
  initialValues,
  submitLabel = 'Add',
  stackId = 'sop-step-popover-create',
  onSubmit,
}: SopAddStepPopoverProps) {
  const [label, setLabel] = useState(initialValues?.label ?? '');
  const [roleSlug, setRoleSlug] = useState<RoleSlug>(
    initialValues?.roleSlug ?? ('developer' as RoleSlug),
  );
  const [instruction, setInstruction] = useState(initialValues?.instruction ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(initialValues?.label ?? '');
    setRoleSlug(initialValues?.roleSlug ?? ('developer' as RoleSlug));
    setInstruction(initialValues?.instruction ?? '');
  }, [initialValues, open]);

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!label.trim()) return;
      onSubmit({ label: label.trim(), roleSlug, instruction: instruction.trim() });
    },
    [instruction, label, onSubmit, roleSlug],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger ? <PopoverTrigger asChild>{trigger}</PopoverTrigger> : null}
      {!trigger && anchor ? <PopoverAnchor asChild>{anchor}</PopoverAnchor> : null}
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[280px] p-3"
        stackId={stackId}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <form onSubmit={handleSubmit} className="space-y-2">
          <Input
            ref={inputRef}
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Step label..."
          />
          <Select value={roleSlug} onValueChange={(value) => setRoleSlug(value as RoleSlug)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HIREABLE_ROLES.map((role) => (
                <SelectItem key={role.slug} value={role.slug}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Instruction (optional)..."
            rows={2}
            className="resize-none text-xs"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!label.trim()}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
