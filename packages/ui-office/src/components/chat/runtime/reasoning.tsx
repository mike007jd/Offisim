'use client';

import { type ReasoningMessagePartComponent, useScrollLock } from '@assistant-ui/react';
import { cn } from '@offisim/ui-core';
import { type VariantProps, cva } from 'class-variance-authority';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { MarkdownText } from './markdown-text';

const ANIMATION_DURATION = 200;

const reasoningVariants = cva('aui-reasoning-root', {
  variants: {
    variant: {
      outline: 'aui-reasoning-root-outline',
      ghost: 'aui-reasoning-root-ghost',
      muted: 'aui-reasoning-root-muted',
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
      className={cn(reasoningVariants({ variant }), className)}
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
    <div data-slot="reasoning-fade" className={cn('aui-reasoning-fade', className)} {...props} />
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
      data-active={active ? 'true' : undefined}
      className={cn('aui-reasoning-trigger', className)}
      {...props}
    >
      <BrainIcon data-slot="reasoning-trigger-icon" className="aui-reasoning-trigger-icon" />
      <span data-slot="reasoning-trigger-label" className="aui-reasoning-trigger-label-wrapper">
        <span>Reasoning{durationText}</span>
        {active ? (
          <span
            aria-hidden
            data-slot="reasoning-trigger-shimmer"
            className="aui-reasoning-trigger-shimmer"
          >
            Reasoning{durationText}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon
        data-slot="reasoning-trigger-chevron"
        className="aui-reasoning-trigger-chevron"
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
      className={cn('aui-reasoning-content', className)}
      {...props}
    >
      {children}
      <ReasoningFade />
    </CollapsibleContent>
  );
}

function ReasoningText({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="reasoning-text" className={cn('aui-reasoning-text', className)} {...props} />
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
