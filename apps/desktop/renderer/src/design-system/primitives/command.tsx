import { cn } from '@/lib/utils.js';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import type * as React from 'react';

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        'flex h-full w-full flex-col overflow-hidden text-[var(--off-ink-1)]',
        className,
      )}
      {...props}
    />
  );
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-[var(--off-sp-3)] border-b border-[var(--off-line-soft)] px-[var(--off-sp-5)]">
      <Search className="size-[15px] shrink-0 text-[var(--off-ink-4)]" />
      <CommandPrimitive.Input
        className={cn(
          'h-[44px] w-full bg-transparent text-[var(--off-fs-base)] text-[var(--off-ink-1)] outline-none placeholder:text-[var(--off-ink-4)]',
          className,
        )}
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
      className={cn(
        'max-h-[340px] overflow-y-auto overflow-x-hidden p-[var(--off-sp-2)]',
        className,
      )}
      {...props}
    />
  );
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className="py-[var(--off-sp-7)] text-center text-[var(--off-fs-sm)] text-[var(--off-ink-3)]"
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
      className={cn(
        'overflow-hidden p-[var(--off-sp-1)] text-[var(--off-ink-1)] [&_[cmdk-group-heading]]:px-[var(--off-sp-3)] [&_[cmdk-group-heading]]:py-[var(--off-sp-2)] [&_[cmdk-group-heading]]:text-[var(--off-fs-micro)] [&_[cmdk-group-heading]]:font-[680] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[var(--off-ls-caps)] [&_[cmdk-group-heading]]:text-[var(--off-ink-3)]',
        className,
      )}
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
      className={cn(
        'relative flex cursor-default select-none items-center gap-[var(--off-sp-3)] rounded-[var(--off-r-sm)] px-[var(--off-sp-3)] py-[var(--off-sp-2)] text-[var(--off-fs-sm)] text-[var(--off-ink-2)] outline-none data-[selected=true]:bg-[var(--off-accent-surface)] data-[selected=true]:text-[var(--off-accent)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-[var(--off-ink-3)] data-[selected=true]:[&_svg]:text-[var(--off-accent)]',
        className,
      )}
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
      className={cn(
        '-mx-[var(--off-sp-1)] my-[var(--off-sp-1)] h-px bg-[var(--off-line-soft)]',
        className,
      )}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'ml-auto font-mono text-[var(--off-fs-micro)] tracking-widest text-[var(--off-ink-4)]',
        className,
      )}
      {...props}
    />
  );
}
