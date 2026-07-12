import { cn } from '@/lib/utils.js';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ChangeEvent, FocusEvent, SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'onChange' | 'value'> {
  options: ReadonlyArray<SelectOption>;
  sunken?: boolean;
  className?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
}

// Radix Select.Item throws on an empty-string value, but callers legitimately
// use '' for "no selection" options (inherit / none). Map '' through a sentinel
// at the Radix boundary so the public API keeps plain '' semantics.
const EMPTY_VALUE_SENTINEL = '__select-empty__';
const toItemValue = (value: string) => (value === '' ? EMPTY_VALUE_SENTINEL : value);
const fromItemValue = (value: string) => (value === EMPTY_VALUE_SENTINEL ? '' : value);

function toChangeEvent(name: string | undefined, value: string): ChangeEvent<HTMLSelectElement> {
  return {
    target: { name, value },
    currentTarget: { name, value },
  } as ChangeEvent<HTMLSelectElement>;
}

function toFocusEvent(
  name: string | undefined,
  value: string | undefined,
): FocusEvent<HTMLSelectElement> {
  return {
    target: { name, value },
    currentTarget: { name, value },
  } as FocusEvent<HTMLSelectElement>;
}

export function Select({
  options,
  sunken = false,
  className,
  value,
  defaultValue,
  onChange,
  onBlur,
  disabled,
  required,
  name,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SelectProps) {
  const fallbackValue = defaultValue?.toString() ?? options[0]?.value;
  const selected = value?.toString();

  return (
    <SelectPrimitive.Root
      name={name}
      value={selected === undefined ? undefined : toItemValue(selected)}
      defaultValue={
        selected === undefined && fallbackValue !== undefined
          ? toItemValue(fallbackValue)
          : undefined
      }
      disabled={disabled}
      required={required}
      onValueChange={(next) => onChange?.(toChangeEvent(name, fromItemValue(next)))}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn('off-select off-focusable', sunken && 'is-sunken', className)}
        onBlur={() => onBlur?.(toFocusEvent(name, selected))}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="off-select-ico">
          <ChevronDown size={14} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="off-select-content off-motion-popover"
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.Viewport className="off-select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={toItemValue(option.value)}
                className="off-select-item"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="off-select-check">
                  <Check size={13} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
