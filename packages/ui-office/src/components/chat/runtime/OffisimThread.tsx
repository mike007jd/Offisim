import {
  AttachmentPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import { Button, cn } from '@offisim/ui-core';
import { ArrowDownToLine } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import type { AttachmentStore } from '../../../lib/attachment-store';
import { SentAttachmentChip } from '../SentAttachmentChip';
import { MarkdownText } from './markdown-text';
import { Reasoning } from './reasoning';
import {
  ThreadAttachmentFrame,
  ThreadMessageContent,
  ThreadSpeakerBadge,
  ThreadStatusFrame,
  ThreadSystemBubble,
  ThreadUserBubble,
} from './thread-surfaces';
import { ToolFallback } from './tool-fallback';
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from './tool-group';
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
  return <ThreadSpeakerBadge>{nodeName}</ThreadSpeakerBadge>;
}

function AttachmentList({ attachmentStore }: { attachmentStore: AttachmentStore | null }) {
  const custom = useMessageCustom();
  const attachments = custom?.attachments ?? [];
  if (attachments.length === 0) return null;
  return (
    <MessagePrimitive.Attachments>
      {({ attachment }) => {
        const ref = attachments.find((item) => item.attachmentId === attachment.id);
        if (!ref) {
          return (
            <AttachmentPrimitive.Root className="offisim-thread-attachment-fallback">
              <AttachmentPrimitive.Name />
            </AttachmentPrimitive.Root>
          );
        }
        return (
          <ThreadAttachmentFrame>
            <SentAttachmentChip attachment={ref} attachmentStore={attachmentStore} />
          </ThreadAttachmentFrame>
        );
      }}
    </MessagePrimitive.Attachments>
  );
}

function TerminalStatusLine() {
  const custom = useMessageCustom();
  if (custom?.status === 'failed') {
    return (
      <ThreadStatusFrame tone="error" role="alert">
        Failed
      </ThreadStatusFrame>
    );
  }
  if (custom?.status === 'interrupted') {
    return <ThreadStatusFrame tone="warning">Interrupted</ThreadStatusFrame>;
  }
  return null;
}

const groupOffisimMessagePart = (part: { type: string }) => {
  if (part.type === 'reasoning') return ['group-reasoning'] as const;
  if (part.type === 'tool-call') return ['group-tool'] as const;
  return null;
};

function ReasoningGroupSurface({
  indices,
  children,
}: {
  indices: readonly number[];
  children: ReactNode;
}) {
  const startIndex = indices[0] ?? 0;
  const endIndex = indices.at(-1) ?? startIndex;
  const isReasoningStreaming = useAuiState((s) => {
    if (s.message.status?.type !== 'running') return false;
    const lastIndex = s.message.parts.length - 1;
    if (lastIndex < 0) return false;
    const lastType = s.message.parts[lastIndex]?.type;
    if (lastType !== 'reasoning') return false;
    return lastIndex >= startIndex && lastIndex <= endIndex;
  });

  return (
    <Reasoning.Root defaultOpen={isReasoningStreaming}>
      <Reasoning.Trigger active={isReasoningStreaming} />
      <Reasoning.Content aria-busy={isReasoningStreaming}>
        <Reasoning.Text>{children}</Reasoning.Text>
      </Reasoning.Content>
    </Reasoning.Root>
  );
}

function ToolGroupSurface({
  indices,
  children,
}: {
  indices: readonly number[];
  children: ReactNode;
}) {
  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={indices.length} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
}

function AssistantGroupedParts() {
  const partCount = useAuiState((s) => s.message.parts.length);
  const isRunning = useAuiState((s) => s.message.status?.type === 'running');

  if (partCount === 0) {
    if (!isRunning) return null;
    return (
      <MessagePrimitive.Parts>
        {({ part }) => {
          switch (part.type) {
            case 'text':
              return <MarkdownText />;
            case 'reasoning':
              return <Reasoning {...part} />;
            case 'tool-call':
              return part.toolUI ?? <ToolFallback {...part} />;
            default:
              return (
                <ThreadStatusFrame tone="warning">
                  Unsupported message part: {part.type}
                </ThreadStatusFrame>
              );
          }
        }}
      </MessagePrimitive.Parts>
    );
  }

  return (
    <MessagePrimitive.GroupedParts groupBy={groupOffisimMessagePart}>
      {({ part, children }) => {
        switch (part.type) {
          case 'group-reasoning':
            return <ReasoningGroupSurface indices={part.indices}>{children}</ReasoningGroupSurface>;
          case 'group-tool':
            return <ToolGroupSurface indices={part.indices}>{children}</ToolGroupSurface>;
          case 'text':
            return <MarkdownText />;
          case 'reasoning':
            return <Reasoning {...part} />;
          case 'tool-call':
            return part.toolUI ?? <ToolFallback {...part} />;
          default:
            return (
              <ThreadStatusFrame tone="warning">
                Unsupported message part: {part.type}
              </ThreadStatusFrame>
            );
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

const createAssistantMessage = (attachmentStore: AttachmentStore | null) => {
  const AssistantMessage = () => {
    return (
      <MessagePrimitive.Root data-role="assistant" className="offisim-thread-assistant-root">
        <SpeakerBadge />
        <ThreadMessageContent>
          <AssistantGroupedParts />
        </ThreadMessageContent>
        <MessagePrimitive.Error>
          <ErrorLine />
        </MessagePrimitive.Error>
        <TerminalStatusLine />
        <AttachmentList attachmentStore={attachmentStore} />
      </MessagePrimitive.Root>
    );
  };
  return AssistantMessage;
};

function ErrorLine() {
  return (
    <ErrorPrimitive.Root className="offisim-thread-error">
      <ErrorPrimitive.Message />
    </ErrorPrimitive.Root>
  );
}

function ScrollToLatestButton() {
  return (
    <ThreadPrimitive.ScrollToBottom
      behavior="smooth"
      render={
        <Button variant="secondary" size="icon" className="offisim-thread-scroll-bottom-button">
          <ArrowDownToLine className="offisim-thread-scroll-bottom-icon" aria-hidden />
        </Button>
      }
      className="offisim-thread-scroll-bottom"
      aria-label="Scroll to latest message"
    />
  );
}

const createUserMessage = (attachmentStore: AttachmentStore | null) => {
  const UserMessage = () => {
    return (
      <MessagePrimitive.Root data-role="user" className="offisim-thread-user-root">
        <ThreadUserBubble>
          <MessagePrimitive.Parts />
          <AttachmentList attachmentStore={attachmentStore} />
        </ThreadUserBubble>
      </MessagePrimitive.Root>
    );
  };
  return UserMessage;
};

const createSystemMessage = (attachmentStore: AttachmentStore | null) => {
  const SystemMessage = () => {
    return (
      <MessagePrimitive.Root data-role="system" className="offisim-thread-system-root">
        <ThreadSystemBubble>
          <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
          <MessagePrimitive.Error>
            <ErrorLine />
          </MessagePrimitive.Error>
          <AttachmentList attachmentStore={attachmentStore} />
        </ThreadSystemBubble>
      </MessagePrimitive.Root>
    );
  };
  return SystemMessage;
};

export interface OffisimThreadProps {
  /** Rendered by `ThreadPrimitive.Empty` when the conversation has no messages. */
  emptyState?: ReactNode;
  /** Single-axis rail content that should stay in the assistant-ui viewport before messages. */
  beforeMessages?: ReactNode;
  /** Single-axis rail content that should stay in the assistant-ui viewport after messages. */
  afterMessages?: ReactNode;
  /** Sticky composer/footer measured by assistant-ui viewport state. */
  footer?: ReactNode;
  attachmentStore?: AttachmentStore | null;
  className?: string;
}

export function OffisimThread({
  emptyState,
  beforeMessages,
  afterMessages,
  footer,
  attachmentStore = null,
  className,
}: OffisimThreadProps) {
  const UserMessage = useMemo(() => createUserMessage(attachmentStore), [attachmentStore]);
  const AssistantMessage = useMemo(
    () => createAssistantMessage(attachmentStore),
    [attachmentStore],
  );
  const SystemMessage = useMemo(() => createSystemMessage(attachmentStore), [attachmentStore]);
  const components = useMemo(
    () => ({ UserMessage, AssistantMessage, SystemMessage }),
    [AssistantMessage, SystemMessage, UserMessage],
  );
  return (
    <ThreadPrimitive.Root className={cn('offisim-thread-root', className)}>
      <ThreadPrimitive.Viewport className="offisim-thread-viewport">
        {beforeMessages}
        <ThreadPrimitive.Empty>{emptyState ?? null}</ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={components} />
        {afterMessages ? (
          <div className="offisim-thread-after-messages">{afterMessages}</div>
        ) : null}
        {footer ? (
          <ThreadPrimitive.ViewportFooter className="offisim-thread-footer">
            <ScrollToLatestButton />
            {footer}
          </ThreadPrimitive.ViewportFooter>
        ) : (
          <ScrollToLatestButton />
        )}
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
