import {
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import { cn } from '@offisim/ui-core';
import { useMemo, type ReactNode } from 'react';
import type { AttachmentStore } from '../../../lib/attachment-store';
import { SentAttachmentChip } from '../SentAttachmentChip';
import { MarkdownText } from './markdown-text';
import { Reasoning } from './reasoning';
import { ToolFallback } from './tool-fallback';
import type { OffisimMessageCustom } from './useOffisimExternalStore';

/**
 * Single-axis assistant-ui message thread for the Office right rail (V3).
 *
 * assistant-ui owns thread rendering — autoscroll (`ThreadPrimitive.Viewport`),
 * markdown (`MarkdownText`), reasoning, tool parts, and Offisim attachment
 * chips. Multi-speaker fidelity comes from the upstream `joinStrategy: 'none'`
 * converter; each finalized speaker segment is its own message and renders its
 * own speaker badge.
 */

function useMessageCustom(): OffisimMessageCustom | undefined {
  return useAuiState(
    (s) => s.message.metadata?.custom as unknown as OffisimMessageCustom | undefined,
  );
}

function SpeakerBadge() {
  const custom = useMessageCustom();
  const nodeName = custom?.nodeName;
  if (!nodeName) return null;
  return (
    <div className="mb-1 inline-flex items-center gap-1.5 text-fs-meta font-medium uppercase tracking-wide text-ink-3">
      <span className="size-1.5 rounded-pill bg-violet" aria-hidden />
      {nodeName}
    </div>
  );
}

function AttachmentList({ attachmentStore }: { attachmentStore: AttachmentStore | null }) {
  const custom = useMessageCustom();
  const attachments = custom?.attachments ?? [];
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1 grid w-full min-w-0 grid-cols-1 gap-1 overflow-hidden sm:grid-cols-2">
      {attachments.map((attachment) => (
        <SentAttachmentChip
          key={attachment.attachmentId}
          attachment={attachment}
          attachmentStore={attachmentStore}
        />
      ))}
    </div>
  );
}

const createAssistantMessage = (attachmentStore: AttachmentStore | null) => {
  const AssistantMessage = () => {
    return (
      <MessagePrimitive.Root
        data-role="assistant"
        className="group/message flex w-full flex-col gap-1 py-2"
      >
        <SpeakerBadge />
        <div className="min-w-0 text-fs-base leading-relaxed text-ink-1 [&_.aui-md]:min-w-0">
          <MessagePrimitive.Parts
            components={{
              Text: MarkdownText,
              Reasoning,
              tools: { Fallback: ToolFallback },
            }}
          />
        </div>
        <MessagePrimitive.Error>
          <ErrorLine />
        </MessagePrimitive.Error>
        <AttachmentList attachmentStore={attachmentStore} />
      </MessagePrimitive.Root>
    );
  };
  return AssistantMessage;
};

function ErrorLine() {
  return (
    <ErrorPrimitive.Root className="mt-1 rounded-md border border-danger/30 bg-danger-surface px-2.5 py-1.5 text-fs-sm text-danger">
      <ErrorPrimitive.Message />
    </ErrorPrimitive.Root>
  );
}

const createUserMessage = (attachmentStore: AttachmentStore | null) => {
  const UserMessage = () => {
    return (
      <MessagePrimitive.Root data-role="user" className="flex w-full justify-end py-2">
        <div className="max-w-prose rounded-lg rounded-br-xs bg-accent-surface px-3 py-2 text-fs-base text-ink-1">
          <MessagePrimitive.Parts />
          <AttachmentList attachmentStore={attachmentStore} />
        </div>
      </MessagePrimitive.Root>
    );
  };
  return UserMessage;
};

export interface OffisimThreadProps {
  /** Rendered by `ThreadPrimitive.Empty` when the conversation has no messages. */
  emptyState?: ReactNode;
  attachmentStore?: AttachmentStore | null;
  className?: string;
}

export function OffisimThread({
  emptyState,
  attachmentStore = null,
  className,
}: OffisimThreadProps) {
  const UserMessage = useMemo(() => createUserMessage(attachmentStore), [attachmentStore]);
  const AssistantMessage = useMemo(
    () => createAssistantMessage(attachmentStore),
    [attachmentStore],
  );
  const components = useMemo(
    () => ({ UserMessage, AssistantMessage }),
    [AssistantMessage, UserMessage],
  );
  return (
    <ThreadPrimitive.Root className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-2">
        <ThreadPrimitive.Empty>{emptyState ?? null}</ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={components} />
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
