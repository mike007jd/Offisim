import { cn } from '@/lib/utils.js';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import type * as React from 'react';

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn('off-command', className)}
      {...props}
    />
  );
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="off-command-input-wrap">
      <Search className="off-command-search-icon" />
      <CommandPrimitive.Input
        className={cn('off-command-input', className)}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('off-command-list', className)}
      {...props}
    />
  );
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className="off-command-empty"
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn('off-command-group', className)}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn('off-command-item', className)}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn('off-command-separator', className)}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('off-command-shortcut', className)}
      {...props}
    />
  );
}
