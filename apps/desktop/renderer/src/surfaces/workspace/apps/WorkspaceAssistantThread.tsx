import { StagedAttachments } from '@/assistant/composer/StagedAttachments.js';
import { useComposerAttachmentStore } from '@/assistant/composer/composer-attachment-store.js';
import { AssistantMessageParts } from '@/assistant/parts/AssistantMessageParts.js';
import { ChatErrorBanner } from '@/assistant/parts/ChatErrorBanner.js';
import { PermissionApprovalBar } from '@/assistant/parts/PermissionApprovalBar.js';
import { RunActivityStrip } from '@/assistant/parts/RunActivityStrip.js';
import {
  assembleAssistantContent,
  isReasoningStreaming,
} from '@/assistant/parts/assistant-message-parts.js';
import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import {
  isConversationRunActive,
  useConversationRun,
} from '@/assistant/runtime/conversation-run-react.js';
import { appendText } from '@/assistant/runtime/desktop-chat-runtime.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { autoTitleThreadFromFirstMessage } from '@/data/auto-title.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import type { ChatAttachment, ChatMessage, Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  type AppendMessage,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  type ThreadMessageLike,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FileText,
  MessageSquarePlus,
  Paperclip,
  SendHorizontal,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type WsConversation, type WsMessage, dayLabelFrom } from '../workspace-data.js';
import { usePersistedWorkspaceMessages } from '../workspace-message-events.js';

const DELIVERABLE_EXTENSION: Record<string, string> = {
  MD: 'md',
  MARKDOWN: 'md',
  TXT: 'txt',
  TEXT: 'txt',
};

function deliverableFileName(card: NonNullable<WsMessage['deliverable']>): string {
  const base =
    card.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || card.id;
  const extension = DELIVERABLE_EXTENSION[card.format.trim().toUpperCase()] ?? 'txt';
  return `${base}.${extension}`;
}

function deliverableDisabledReason({
  projectId,
  workspaceBound,
  content,
}: {
  projectId: string | null;
  workspaceBound: boolean;
  content: string | undefined;
}): string | null {
  if (!isTauriRuntime()) return 'Open and export need the desktop app';
  if (!projectId || !workspaceBound) return 'Bind a project folder to export';
  if (!content?.trim()) return 'This artifact has metadata only; no exportable body is available';
  return null;
}

function wsMessageToAssistant(message: WsMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.author === 'boss' ? 'user' : 'assistant',
    content: assembleAssistantContent(message),
    createdAt: new Date(),
    metadata: { custom: message as unknown as Record<string, unknown> },
  };
}

function workspaceTimeLabel(date = new Date()): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function mergeWorkspaceMessages(...sources: WsMessage[][]): WsMessage[] {
  const merged = new Map<string, WsMessage>();
  for (const source of sources) {
    for (const message of source) {
      merged.set(message.id, message);
    }
  }
  return Array.from(merged.values()).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

function chatAttachmentToWorkspace(attachments: readonly ChatAttachment[] | undefined) {
  const first = attachments?.[0];
  if (!first) return undefined;
  return {
    id: first.id,
    name: first.name,
    meta:
      attachments && attachments.length > 1
        ? `${first.sizeLabel} · ${attachments.length} files staged`
        : first.sizeLabel,
  };
}

function chatMessageToWorkspaceMessage(message: ChatMessage, active: WsConversation): WsMessage {
  const isBoss = message.author === 'boss';
  return {
    id: message.id,
    author: isBoss ? 'boss' : 'employee',
    employeeId: isBoss ? null : message.employeeId,
    role:
      message.author === 'system' ? 'runtime' : active.kind === 'group' ? 'workspace' : undefined,
    timeLabel: workspaceTimeLabel(new Date(message.at)),
    at: message.at,
    body: message.body,
    reasoning: message.reasoning,
    toolCalls: message.toolCalls,
    attachment: chatAttachmentToWorkspace(message.attachments),
  };
}

function DeliverableInline({
  card,
  byId,
  projectId,
  workspaceBound,
}: {
  card: NonNullable<WsMessage['deliverable']>;
  byId: Map<string, Employee>;
  projectId: string | null;
  workspaceBound: boolean;
}) {
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'open' | 'export' | null>(null);
  const disabledReason = deliverableDisabledReason({
    projectId,
    workspaceBound,
    content: card.content,
  });
  const disabledTitle = busyAction ? 'Deliverable action is running' : (disabledReason ?? '');

  async function persistDeliverable(action: 'open' | 'export') {
    if (disabledReason || !projectId || !card.content) {
      toast.error(disabledReason ?? 'Deliverable is not ready');
      return;
    }
    setBusyAction(action);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const relativePath =
        action === 'open' && savedPath
          ? savedPath
          : await invoke<string>('save_deliverable_to_local', {
              projectId,
              fileName: deliverableFileName(card),
              content: card.content,
            });
      setSavedPath(relativePath);
      if (action === 'open') {
        await invoke('open_local_path', { projectId, path: relativePath });
        toast.success('Opened deliverable', { description: relativePath });
      } else {
        toast.success('Exported deliverable', { description: relativePath });
      }
    } catch (error) {
      toast.error(action === 'open' ? 'Open deliverable failed' : 'Export deliverable failed', {
        description: safeErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="off-ws-dlv">
      <div className="off-ws-dlv-head">
        <Icon icon={FileText} size="sm" className="off-ws-dlv-ico" />
        <div className="off-ws-dlv-main">
          <div className="off-ws-dlv-titlerow">
            <span className="off-ws-dlv-title">{card.title}</span>
            <span className="off-ws-dlv-meta" title="Export format">
              {card.meta} · {card.format}
            </span>
          </div>
          <div className="off-ws-dlv-stack">
            {card.contributorIds.map((id) => {
              const e = byId.get(id);
              if (!e) return null;
              return (
                <EmployeeAvatar
                  key={id}
                  seed={e.id}
                  appearance={e.appearance}
                  colorA={e.avatarA}
                  colorB={e.avatarB}
                  size={20}
                  brand={e.kind === 'external'}
                  className="off-ws-dlv-av"
                />
              );
            })}
          </div>
        </div>
      </div>
      <div className="off-ws-dlv-actions">
        <button
          type="button"
          className="off-ws-dlv-btn off-focusable"
          disabled={Boolean(disabledReason) || busyAction !== null}
          title={disabledTitle}
          onClick={() => void persistDeliverable('open')}
        >
          {busyAction === 'open' ? 'Opening...' : 'Open'}
        </button>
        <button
          type="button"
          className="off-ws-dlv-btn off-focusable"
          disabled={Boolean(disabledReason) || busyAction !== null}
          title={disabledTitle}
          onClick={() => void persistDeliverable('export')}
        >
          {busyAction === 'export' ? 'Exporting...' : 'Export'}
        </button>
      </div>
    </div>
  );
}

/** Bouncing-dot typing indicator shown between send and the first streamed
 *  token, shaped like an incoming employee message row. */
function ThinkingRow({ employee }: { employee: Employee | null }) {
  return (
    <div className="off-ws-msg-row" aria-live="polite">
      <div className="off-ws-msg-from">
        {employee ? (
          <EmployeeAvatar
            seed={employee.id}
            appearance={employee.appearance}
            colorA={employee.avatarA}
            colorB={employee.avatarB}
            size={22}
            brand={employee.kind === 'external'}
          />
        ) : null}
        <span className="off-ws-msg-nm">{employee?.name ?? 'Team'}</span>
        <span className="off-ws-msg-rl">thinking…</span>
      </div>
      <div className="off-ws-bubble is-thinking">
        <span className="off-ws-thinking-dots" aria-label="Employee is thinking">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  byId,
  projectId,
  workspaceBound,
}: {
  message: WsMessage;
  byId: Map<string, Employee>;
  projectId: string | null;
  workspaceBound: boolean;
}) {
  const employee = message.employeeId ? byId.get(message.employeeId) : null;
  const isMe = message.author === 'boss';
  const reasoningStreaming = isReasoningStreaming(message);
  return (
    <MessagePrimitive.Root asChild>
      <div className={cn('off-ws-msg-row', isMe && 'is-me')}>
        <div className="off-ws-msg-from">
          {isMe ? (
            <EmployeeAvatar
              seed="Boss"
              colorA={UI_DATA_COLORS.bossA}
              colorB={UI_DATA_COLORS.bossB}
              size={22}
            />
          ) : employee ? (
            <EmployeeAvatar
              seed={employee.id}
              appearance={employee.appearance}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
              size={22}
              brand={employee.kind === 'external'}
            />
          ) : null}
          <span className="off-ws-msg-nm">{isMe ? 'You' : (employee?.name ?? 'Employee')}</span>
          {message.role ? <span className="off-ws-msg-rl">{message.role}</span> : null}
          <span className="off-ws-msg-tm">{message.timeLabel}</span>
        </div>
        <div className={cn('off-ws-bubble', isMe && 'is-me')}>
          <AssistantMessageParts reasoningStreaming={reasoningStreaming} />
        </div>
        {message.attachment ? (
          <div className="off-ws-attachment">
            <span className="off-ws-file-icon">
              <Icon icon={FileText} size="sm" />
            </span>
            <span>
              <span className="off-ws-fname">{message.attachment.name}</span>
              <span className="off-ws-fmeta">{message.attachment.meta}</span>
            </span>
            <span className="off-ws-download">
              <Icon icon={Download} size="sm" />
            </span>
          </div>
        ) : null}
        {message.deliverable ? (
          <DeliverableInline
            card={message.deliverable}
            byId={byId}
            projectId={projectId}
            workspaceBound={workspaceBound}
          />
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}

export function WorkspaceAssistantThread({
  active,
  messages,
  byId,
  projectId,
  companyId,
  workspaceBound,
}: {
  active: WsConversation;
  messages: WsMessage[];
  byId: Map<string, Employee>;
  projectId: string | null;
  companyId: string | null;
  workspaceBound: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnabled = isTauriRuntime();
  const queryClient = useQueryClient();
  const run = useConversationRun(active.id);
  const staged = useComposerAttachmentStore((s) => s.staged);
  const stageFiles = useComposerAttachmentStore((s) => s.stageFiles);
  const clearStaged = useComposerAttachmentStore((s) => s.clearStaged);
  const storageAvailable = useComposerAttachmentStore((s) => s.storageAvailable);
  const persistedMessages = usePersistedWorkspaceMessages(active.id);
  const activeConversationId = active.id;
  const liveMessages = useMemo(
    () => run.liveMessages.map((message) => chatMessageToWorkspaceMessage(message, active)),
    [active, run.liveMessages],
  );
  const runtimeMessages = useMemo(
    () => mergeWorkspaceMessages(messages, persistedMessages.data ?? [], liveMessages),
    [messages, persistedMessages.data, liveMessages],
  );
  const runtimeMessageById = useMemo(
    () => new Map(runtimeMessages.map((message) => [message.id, message])),
    [runtimeMessages],
  );
  const isRunning = isConversationRunActive(run.phase);
  const awaitingReply =
    isRunning &&
    !run.liveMessages.some(
      (message) =>
        message.author !== 'boss' &&
        (message.body.trim() || message.reasoning?.trim() || message.toolCalls?.length),
    );
  // Day separator follows the first rendered message's real timestamp. Messages
  // without one (fixtures, just-sent drafts) are "now"-shaped, so 'Today' holds.
  // Scope: one separator per thread (labels the conversation start), not
  // per-day boundaries between message groups.
  const firstMessageAt = runtimeMessages[0]?.at;
  const daySepLabel = firstMessageAt ? dayLabelFrom(firstMessageAt, Date.now()) : 'Today';

  useEffect(() => {
    if (!persistedMessages.error) return;
    toast.error('Workspace transcript load failed', {
      description: safeErrorMessage(persistedMessages.error),
    });
  }, [persistedMessages.error]);

  useEffect(() => {
    if (activeConversationId) clearStaged();
  }, [activeConversationId, clearStaged]);

  function stageFileList(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).map((f) => ({
      name: f.name,
      bytes: f.size,
      type: f.type,
      file: f,
    }));
    if (files.length) void stageFiles(files);
  }

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = appendText(message);
      if (!text) return;
      if (!chatEnabled) {
        toast.error('Workspace chat requires the release desktop runtime');
        return;
      }
      if (!companyId) {
        toast.error('Cannot send: no active company is bound to this workspace.');
        return;
      }
      const attached = staged.filter((attachment) => attachment.status === 'attached');
      clearStaged();
      try {
        // Title the conversation from its first user message so the messenger
        // list stops showing "New conversation". Fire-and-forget and self-
        // skipping once the thread is already titled (auto or manual rename).
        void autoTitleThreadFromFirstMessage({
          threadId: active.id,
          projectId,
          firstUserText: text,
          queryClient,
        }).catch((err: unknown) => {
          console.warn('[WorkspaceAssistantThread] auto-title failed', {
            threadId: active.id,
            err,
          });
        });
        await conversationRunController.submit({
          companyId,
          projectId,
          threadId: active.id,
          employeeId: active.employeeId,
          text,
          stagedAttachments: attached,
          source: 'workspace',
        });
      } catch (error) {
        toast.error('Pi Agent workspace chat failed', { description: safeErrorMessage(error) });
      }
    },
    [
      active.employeeId,
      active.id,
      chatEnabled,
      clearStaged,
      staged,
      companyId,
      projectId,
      queryClient,
    ],
  );
  const onCancel = useCallback(async () => {
    conversationRunController.stop(active.id);
  }, [active.id]);
  const runtime = useExternalStoreRuntime({
    messages: runtimeMessages,
    onNew,
    convertMessage: wsMessageToAssistant,
    isRunning,
    onCancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="off-ws-thread">
        <ThreadPrimitive.Viewport className="off-ws-conv-scroll">
          {runtimeMessages.length === 0 ? (
            <EmptyState
              icon={MessageSquarePlus}
              title="No messages yet"
              description="Write a message below to start this conversation."
            />
          ) : (
            <section className="off-ws-messages">
              <span className="off-ws-day-sep">{daySepLabel}</span>
              <ThreadPrimitive.Messages>
                {({ message }) => {
                  const custom =
                    runtimeMessageById.get(message.id) ??
                    (message.metadata?.custom as unknown as WsMessage | undefined);
                  return custom ? (
                    <MessageRow
                      message={custom}
                      byId={byId}
                      projectId={projectId}
                      workspaceBound={workspaceBound}
                    />
                  ) : null;
                }}
              </ThreadPrimitive.Messages>
              {awaitingReply ? (
                <ThinkingRow
                  employee={active.employeeId ? (byId.get(active.employeeId) ?? null) : null}
                />
              ) : null}
            </section>
          )}
        </ThreadPrimitive.Viewport>

        <div className="off-ws-run-status">
          <PermissionApprovalBar threadId={active.id} />
          <RunActivityStrip threadId={active.id} />
          <ChatErrorBanner threadId={active.id} />
        </div>
        <ComposerPrimitive.Root className="off-ws-composer">
          <StagedAttachments />
          <div className="off-ws-composer-shell">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                stageFileList(event.target.files);
                event.target.value = '';
              }}
            />
            <IconButton
              icon={Paperclip}
              label="Attach file"
              variant="ghost"
              size="iconSm"
              className="off-ws-composer-attach"
              title={storageAvailable ? 'Attach file' : 'Attachment storage unavailable'}
              onClick={() => fileInput.current?.click()}
            />
            <ComposerPrimitive.Input
              className="off-ws-composer-input"
              placeholder={`Message ${active.title}…`}
              rows={1}
              submitOnEnter
              disabled={!chatEnabled}
              title={
                chatEnabled
                  ? `Message ${active.title}`
                  : 'Workspace chat requires the release desktop runtime'
              }
            />
            {isRunning ? (
              <ComposerPrimitive.Cancel
                className="off-ws-send off-focusable"
                aria-label="Stop run"
                title="Stop run"
              >
                <Icon icon={Square} size="sm" />
              </ComposerPrimitive.Cancel>
            ) : (
              <ComposerPrimitive.Send
                className="off-ws-send off-focusable"
                aria-label="Send message"
                disabled={!chatEnabled}
                title={
                  chatEnabled
                    ? 'Send message'
                    : 'Workspace chat requires the release desktop runtime'
                }
              >
                <Icon icon={SendHorizontal} size="sm" />
              </ComposerPrimitive.Send>
            )}
          </div>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
