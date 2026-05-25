import { cn } from '@/lib/utils.js';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import type * as React from 'react';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const menuSurface =
  'z-50 min-w-[180px] overflow-hidden rounded-[var(--off-r-md)] border border-[var(--off-line)] bg-[var(--off-surface-1)] p-[var(--off-sp-1)] shadow-[var(--off-elev-3)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95';

const itemBase =
  'off-focusable relative flex cursor-default select-none items-center gap-[var(--off-sp-3)] rounded-[var(--off-r-sm)] px-[var(--off-sp-3)] py-[var(--off-sp-2)] text-[var(--off-fs-sm)] text-[var(--off-ink-2)] outline-none transition-colors data-[highlighted]:bg-[var(--off-surface-sunken)] data-[highlighted]:text-[var(--off-ink-1)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--off-ink-3)]';

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(menuSurface, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(itemBase, inset && 'pl-[var(--off-sp-8)]', className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(itemBase, 'pl-[var(--off-sp-7)]', className)}
      checked={checked}
      {...props}
    >
      <span className="absolute left-[var(--off-sp-2)] flex items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-[14px]" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(itemBase, 'pl-[var(--off-sp-7)]', className)}
      {...props}
    >
      <span className="absolute left-[var(--off-sp-3)] flex items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <span className="size-[6px] rounded-full bg-[var(--off-accent)]" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'px-[var(--off-sp-3)] py-[var(--off-sp-1)] text-[var(--off-fs-micro)] font-[680] uppercase tracking-[var(--off-ls-caps)] text-[var(--off-ink-3)]',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn(
        '-mx-[var(--off-sp-1)] my-[var(--off-sp-1)] h-px bg-[var(--off-line-soft)]',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'ml-auto text-[var(--off-fs-micro)] font-mono text-[var(--off-ink-4)]',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        itemBase,
        'data-[state=open]:bg-[var(--off-surface-sunken)]',
        inset && 'pl-[var(--off-sp-8)]',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-[14px]" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return <DropdownMenuPrimitive.SubContent className={cn(menuSurface, className)} {...props} />;
}
