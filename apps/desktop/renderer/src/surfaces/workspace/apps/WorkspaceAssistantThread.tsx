import { StagedAttachments } from '@/assistant/composer/StagedAttachments.js';
import { SkillInstallConfirmBar } from '@/assistant/parts/SkillInstallConfirmBar.js';
import { useRunStore } from '@/assistant/run-store.js';
import {
  appendText,
  materializeChatTurn,
  newDraftId,
  subscribeReplyStream,
} from '@/assistant/runtime/desktop-chat-runtime.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  type AppendMessage,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  type ThreadMessageLike,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { Download, FileText, MessageSquarePlus, Paperclip, SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { dayLabelFrom, type WsConversation, type WsMessage } from '../workspace-data.js';
import {
  persistWorkspaceMessage,
  usePersistedWorkspaceMessages,
} from '../workspace-message-events.js';

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
    content: [{ type: 'text', text: message.body }],
    createdAt: new Date(),
    metadata: { custom: message as unknown as Record<string, unknown> },
  };
}

function workspaceTimeLabel(date = new Date()): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function mergeWorkspaceMessages(...sources: WsMessage[][]): WsMessage[] {
  const seen = new Set<string>();
  const merged: WsMessage[] = [];
  for (const source of sources) {
    for (const message of source) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      merged.push(message);
    }
  }
  return merged;
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
          <MessagePrimitive.Parts>
            {({ part }) =>
              part.type === 'text' ? (
                <span>
                  <MessagePartPrimitive.Text />
                  <MessagePartPrimitive.InProgress>
                    <span className="off-msg-cursor">|</span>
                  </MessagePartPrimitive.InProgress>
                </span>
              ) : null
            }
          </MessagePrimitive.Parts>
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
  const [drafts, setDrafts] = useState<WsMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  // True between send and the first streamed token — drives the typing indicator.
  const [awaitingReply, setAwaitingReply] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnabled = isTauriRuntime();
  const staged = useRunStore((s) => s.staged);
  const stageFiles = useRunStore((s) => s.stageFiles);
  const clearStaged = useRunStore((s) => s.clearStaged);
  const storageAvailable = useRunStore((s) => s.storageAvailable);
  const persistedMessages = usePersistedWorkspaceMessages(active.id);
  const runtimeMessages = useMemo(
    () => mergeWorkspaceMessages(messages, persistedMessages.data ?? [], drafts),
    [messages, persistedMessages.data, drafts],
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

  // Aborts any in-flight provider request and resets the local request state.
  // Shared by the cancel action and the unmount cleanup so a conversation
  // switch (which remounts this keyed component) never orphans a live request.
  const abortInFlight = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    // Cancel the in-flight graph execution for this conversation. The
    // orchestration abort signals the running graph stream; the underlying
    // `llm_fetch` is cancelled through the run's AbortSignal. Harmless no-op
    // when nothing is in flight.
    if (companyId) {
      void import('@/runtime/desktop-agent-runtime.js')
        .then(({ getDesktopAgentRuntime }) => getDesktopAgentRuntime(companyId))
        .then((runtime) => runtime.abort(active.id))
        .catch(() => undefined);
    }
    const requestId = requestIdRef.current;
    if (requestId) {
      void import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('llm_fetch_abort', { requestId }).catch(() => undefined),
      );
    }
    requestIdRef.current = null;
  }, [companyId, active.id]);

  useEffect(() => {
    setDrafts([]);
    requestIdRef.current = null;
    abortControllerRef.current = null;
    setIsSending(false);
    clearStaged();
    return () => {
      abortInFlight();
    };
  }, [clearStaged, abortInFlight]);

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
      const attached = staged.filter((attachment) => attachment.status === 'attached');
      const firstAttachment = attached[0]
        ? {
            id: attached[0].attachmentId ?? attached[0].id,
            name: attached[0].name,
            meta:
              attached.length > 1
                ? `${attached[0].sizeLabel} · ${attached.length} files staged`
                : attached[0].sizeLabel,
          }
        : undefined;
      const userMessage: WsMessage = {
        id: newDraftId('workspace-user'),
        author: 'boss',
        employeeId: null,
        timeLabel: workspaceTimeLabel(),
        body: text,
        attachment: firstAttachment,
      };
      setDrafts((prev) => [...prev, userMessage]);
      clearStaged();
      const requestId = newDraftId('workspace-provider');
      requestIdRef.current = requestId;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsSending(true);
      setAwaitingReply(true);
      try {
        await persistWorkspaceMessage({
          threadId: active.id,
          message: userMessage,
          companyId,
          projectId,
        });
        // Every workspace chat runs through the real LangGraph agent runtime
        // (the single-shot direct-provider path was retired in slice 3). A chat
        // with no active company cannot assemble a runtime — fail honestly.
        if (!companyId) {
          throw new Error('Cannot send: no active company is bound to this workspace.');
        }
        const materialized = await materializeChatTurn({
          text,
          companyId,
          threadId: active.id,
          staged: attached,
        });
        const { getDesktopAgentRuntime } = await import('@/runtime/desktop-agent-runtime.js');
        const { runtimeEventBus } = await import('@/runtime/repos.js');
        const runtime = await getDesktopAgentRuntime(companyId);

        // Stream the reply into a single assistant draft (mirrors the Office
        // runtime): append the graph's `content` channel for this thread's reply
        // nodes. The draft is created lazily on the first chunk (a provider error
        // before any token leaves no empty bubble); the authoritative response
        // overwrites it afterward.
        const streamDraftId = newDraftId('workspace-assistant');
        const makeAssistantDraft = (body: string): WsMessage => ({
          id: streamDraftId,
          author: 'employee',
          employeeId: active.employeeId,
          role: active.kind === 'group' ? 'workspace' : undefined,
          timeLabel: workspaceTimeLabel(),
          body,
        });
        const upsertDraft = (body: string, mode: 'append' | 'set') => {
          setAwaitingReply(false);
          setDrafts((prev) => {
            const existing = prev.find((draft) => draft.id === streamDraftId);
            if (!existing) return [...prev, makeAssistantDraft(body)];
            const nextBody = mode === 'append' ? `${existing.body}${body}` : body;
            return prev.map((draft) =>
              draft.id === streamDraftId ? { ...draft, body: nextBody } : draft,
            );
          });
        };
        const unsubscribe = subscribeReplyStream(runtimeEventBus, active.id, (chunk) =>
          upsertDraft(chunk, 'append'),
        );
        let response: string;
        try {
          response = await runtime.execute({
            text: materialized.promptText,
            threadId: active.id,
            employeeId: active.employeeId,
            projectId,
          });
        } finally {
          // InMemoryEventBus has no auto-cleanup — always release this handler.
          unsubscribe();
        }
        // A late-resolving cancel: keep whatever already streamed into the draft.
        if (controller.signal.aborted) return;
        const assistantMessage = makeAssistantDraft(response);
        await persistWorkspaceMessage({
          threadId: active.id,
          message: assistantMessage,
          companyId,
          projectId,
        });
        // Replace the streamed draft with the authoritative final reply (or
        // create it when the reply did not stream).
        upsertDraft(response, 'set');
      } catch (error) {
        // An aborted request (cancel or conversation switch) is not a failure;
        // skip the error draft and toast so it does not surface as a bridge error.
        if (controller.signal.aborted) {
          return;
        }
        const messageText = safeErrorMessage(error);
        toast.error('Workspace chat send failed', { description: messageText });
        const failureMessage: WsMessage = {
          id: newDraftId('workspace-provider-error'),
          author: 'employee',
          employeeId: active.employeeId,
          role: 'runtime',
          timeLabel: workspaceTimeLabel(),
          body: `Workspace chat failed: ${messageText}`,
        };
        setDrafts((prev) => [...prev, failureMessage]);
        void persistWorkspaceMessage({
          threadId: active.id,
          message: failureMessage,
          companyId,
          projectId,
        }).catch(() => undefined);
      } finally {
        setAwaitingReply(false);
        if (!controller.signal.aborted) {
          requestIdRef.current = null;
          abortControllerRef.current = null;
          setIsSending(false);
        }
      }
    },
    [
      active.employeeId,
      active.id,
      active.kind,
      chatEnabled,
      clearStaged,
      staged,
      companyId,
      projectId,
    ],
  );
  const onCancel = useCallback(async () => {
    abortInFlight();
    setIsSending(false);
    setAwaitingReply(false);
  }, [abortInFlight]);
  const runtime = useExternalStoreRuntime({
    messages: runtimeMessages,
    onNew,
    convertMessage: wsMessageToAssistant,
    isRunning: isSending,
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
                  const custom = message.metadata?.custom as unknown as WsMessage | undefined;
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

        <SkillInstallConfirmBar companyId={companyId} threadId={active.id} />
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
            <ComposerPrimitive.Send
              className="off-ws-send off-focusable"
              aria-label="Send message"
              disabled={!chatEnabled || isSending}
              title={
                chatEnabled
                  ? 'Send message'
                  : 'Workspace chat requires the release desktop runtime'
              }
            >
              <Icon icon={SendHorizontal} size="sm" />
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
