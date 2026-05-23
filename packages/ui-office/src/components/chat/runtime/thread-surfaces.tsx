import { cn } from '@offisim/ui-core';
import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';

const threadBubbleVariants = cva('', {
  variants: {
    tone: {
      user: 'offisim-thread-user-bubble',
      system: 'offisim-thread-system-bubble',
    },
  },
});

const threadStatusVariants = cva('offisim-thread-status-frame', {
  variants: {
    tone: {
      error: 'offisim-thread-status-frame-error',
      warning: 'offisim-thread-status-frame-warning',
    },
  },
  defaultVariants: { tone: 'error' },
});

export function ThreadSpeakerBadge({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      data-slot="thread-speaker-badge"
      className={cn('offisim-thread-speaker-badge', className)}
      {...props}
    >
      <span className="offisim-thread-speaker-dot" aria-hidden />
      {children}
    </div>
  );
}

export function ThreadMessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="thread-message-content"
      className={cn('offisim-thread-message-content', className)}
      {...props}
    />
  );
}

export function ThreadAttachmentFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="thread-attachment-frame"
      className={cn('offisim-thread-attachment-frame', className)}
      {...props}
    />
  );
}

export function ThreadUserBubble({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="thread-user-bubble"
      className={cn(threadBubbleVariants({ tone: 'user' }), className)}
      {...props}
    />
  );
}

export function ThreadSystemBubble({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="thread-system-bubble"
      className={cn(threadBubbleVariants({ tone: 'system' }), className)}
      {...props}
    />
  );
}

export function ThreadStatusFrame({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof threadStatusVariants>) {
  return (
    <div
      data-slot="thread-status-frame"
      data-tone={tone ?? 'error'}
      className={cn(threadStatusVariants({ tone }), className)}
      {...props}
    />
  );
}
