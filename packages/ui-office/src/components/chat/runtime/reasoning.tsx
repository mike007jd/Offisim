'use client';

import { type ReasoningMessagePartComponent, useScrollLock } from '@assistant-ui/react';
import { cn } from '@offisim/ui-core';
import { type VariantProps, cva } from 'class-variance-authority';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { MarkdownText } from './markdown-text';

const ANIMATION_DURATION = 200;

const reasoningVariants = cva('aui-reasoning-root mb-4 w-full', {
  variants: {
    variant: {
      outline: 'rounded-r-md border px-3 py-2',
      ghost: '',
      muted: 'rounded-r-md bg-surface-sunken/50 px-3 py-2',
    },
  },
  defaultVariants: {
    variant: 'outline',
  },
});

export type ReasoningRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'open' | 'onOpenChange'
> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  };

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        lockScroll();
      }
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="reasoning-root"
      data-variant={variant}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('group/reasoning-root', reasoningVariants({ variant, className }))}
      // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
      style={
        {
          '--animation-duration': `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  );
}

function ReasoningFade({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="reasoning-fade"
      className={cn(
        'aui-reasoning-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8',
        'bg-gradient-to-t from-bg to-transparent',
        'group-data-[variant=muted]/reasoning-root:from-surface-sunken/50',
        'fade-in-0 animate-in',
        'group-data-[state=open]/collapsible-content:animate-out',
        'group-data-[state=open]/collapsible-content:fade-out-0',
        'group-data-[state=open]/collapsible-content:delay-[calc(var(--animation-duration)*0.75)]',
        'group-data-[state=open]/collapsible-content:fill-mode-forwards',
        'duration-(--animation-duration)',
        'group-data-[state=open]/collapsible-content:duration-(--animation-duration)',
        className,
      )}
      {...props}
    />
  );
}

function ReasoningTrigger({
  active,
  duration,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  active?: boolean;
  duration?: number;
}) {
  const durationText = duration ? ` (${duration}s)` : '';

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      className={cn(
        'aui-reasoning-trigger group/trigger flex max-w-prose items-center gap-2 py-1 text-ink-3 text-fs-sm transition-colors hover:text-ink-1',
        className,
      )}
      {...props}
    >
      <BrainIcon
        data-slot="reasoning-trigger-icon"
        className="aui-reasoning-trigger-icon size-4 shrink-0"
      />
      <span
        data-slot="reasoning-trigger-label"
        className="aui-reasoning-trigger-label-wrapper relative inline-block leading-none"
      >
        <span>Reasoning{durationText}</span>
        {active ? (
          <span
            aria-hidden
            data-slot="reasoning-trigger-shimmer"
            className="aui-reasoning-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            Reasoning{durationText}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon
        data-slot="reasoning-trigger-chevron"
        className={cn(
          'aui-reasoning-trigger-chevron mt-0.5 size-4 shrink-0',
          'transition-transform duration-(--animation-duration) ease-out',
          'group-data-[state=closed]/trigger:-rotate-90',
          'group-data-[state=open]/trigger:rotate-0',
        )}
      />
    </CollapsibleTrigger>
  );
}

function ReasoningContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        'aui-reasoning-content relative overflow-hidden text-ink-3 text-fs-sm outline-none',
        'group/collapsible-content ease-out',
        'data-[state=closed]:animate-collapsible-up',
        'data-[state=open]:animate-collapsible-down',
        'data-[state=closed]:fill-mode-forwards',
        'data-[state=closed]:pointer-events-none',
        'data-[state=open]:duration-(--animation-duration)',
        'data-[state=closed]:duration-(--animation-duration)',
        className,
      )}
      {...props}
    >
      {children}
      <ReasoningFade />
    </CollapsibleContent>
  );
}

function ReasoningText({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="reasoning-text"
      className={cn(
        'aui-reasoning-text relative z-0 max-h-64 flex flex-col gap-4 overflow-y-auto ps-6 pt-2 pb-2 leading-relaxed',
        'transform-gpu transition-[transform,opacity]',
        'group-data-[state=open]/collapsible-content:animate-in',
        'group-data-[state=closed]/collapsible-content:animate-out',
        'group-data-[state=open]/collapsible-content:fade-in-0',
        'group-data-[state=closed]/collapsible-content:fade-out-0',
        'group-data-[state=open]/collapsible-content:slide-in-from-top-4',
        'group-data-[state=closed]/collapsible-content:slide-out-to-top-4',
        'group-data-[state=open]/collapsible-content:duration-(--animation-duration)',
        'group-data-[state=closed]/collapsible-content:duration-(--animation-duration)',
        className,
      )}
      {...props}
    />
  );
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />;

const Reasoning = memo(ReasoningImpl) as unknown as ReasoningMessagePartComponent & {
  Root: typeof ReasoningRoot;
  Trigger: typeof ReasoningTrigger;
  Content: typeof ReasoningContent;
  Text: typeof ReasoningText;
  Fade: typeof ReasoningFade;
};

Reasoning.displayName = 'Reasoning';
Reasoning.Root = ReasoningRoot;
Reasoning.Trigger = ReasoningTrigger;
Reasoning.Content = ReasoningContent;
Reasoning.Text = ReasoningText;
Reasoning.Fade = ReasoningFade;

export {
  Reasoning,
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants,
};
