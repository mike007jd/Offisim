import { useUiState } from '@/app/ui-state.js';
import { StagedAttachments } from '@/assistant/composer/StagedAttachments.js';
import { useRunStore } from '@/assistant/run-store.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { useEmployees, useProjects } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  findDefaultChatProviderProfile,
  loadRuntimeProviderProfiles,
  safeErrorMessage,
  sendProviderText,
} from '@/lib/provider-bridge.js';
import { cn } from '@/lib/utils.js';
import { useProviderConfigs } from '@/surfaces/settings/settings-data.js';
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
import {
  AlertTriangle,
  Bot,
  Building2,
  Check,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Megaphone,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  Plus,
  SendHorizontal,
  Shield,
  Sparkles,
  Store,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  MODE_LABEL,
  type SysCard,
  type SysLevel,
  type SysSource,
  type WsConversation,
  type WsMessage,
  type WsRunRecord,
  useWsConversations,
  useWsSystemCards,
  useWsThread,
} from '../workspace-data.js';

type ConvFacet = 'chat' | 'files';

const WORKSPACE_MAX_OUTPUT_TOKENS = 512;

const PRESENCE_CLASS: Record<NonNullable<WsConversation['presence']>, string> = {
  working: 'is-working',
  idle: 'is-idle',
  blocked: 'is-blocked',
  offline: 'is-offline',
};

const SYS_LEVEL_ICON: Record<SysLevel, typeof Check> = {
  info: Store,
  success: Users,
  warning: AlertTriangle,
  error: X,
};

const SYS_SOURCE_LABEL: Record<SysSource, string> = {
  runtime: 'Runtime',
  hr: 'HR',
  market: 'Market',
  install: 'Install',
};

const SYS_SOURCE_ICON: Record<SysSource, typeof Store> = {
  runtime: AlertTriangle,
  hr: Users,
  market: Store,
  install: Plus,
};

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
  if (!isTauriRuntime()) return 'Open and export require the desktop runtime';
  if (!projectId || !workspaceBound) return 'Bind a project workspace folder to export artifacts';
  if (!content?.trim()) return 'This artifact has metadata only; no exportable body is available';
  return null;
}

function appendText(message: AppendMessage): string {
  return message.content
    .map((part) => ('text' in part ? part.text : ''))
    .join('')
    .trim();
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

function workspaceDraftId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function workspaceTimeLabel(date = new Date()): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function sendWorkspaceProviderMessage(
  text: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string> {
  const profiles = await loadRuntimeProviderProfiles();
  const profile = findDefaultChatProviderProfile(profiles);
  if (!profile) {
    throw new Error('Runtime provider profile is not configured.');
  }
  return sendProviderText({
    profile,
    text,
    requestId,
    maxOutputTokens: WORKSPACE_MAX_OUTPUT_TOKENS,
    signal,
  });
}

function ConvAvatar({
  conv,
  employee,
  size = 40,
}: {
  conv: WsConversation;
  employee: Employee | null;
  size?: number;
}) {
  const avatarClass = cn('off-ws-im-av', size <= 30 && 'is-compact');
  if (conv.kind === 'group') {
    return (
      <span className={cn(avatarClass, 'is-group')}>
        <Icon icon={conv.id === 'th-design' ? Users : Building2} size="sm" />
      </span>
    );
  }
  if (conv.kind === 'system') {
    return (
      <span className={cn(avatarClass, 'is-bot')}>
        <Icon icon={Sparkles} size="sm" />
      </span>
    );
  }
  if (employee) {
    return (
      <span className={cn('off-ws-im-av-wrap', size <= 30 && 'is-compact')}>
        <EmployeeAvatar
          seed={employee.id}
          appearance={employee.appearance}
          colorA={employee.avatarA}
          colorB={employee.avatarB}
          size={size}
          brand={employee.kind === 'external'}
          className={cn('off-ws-im-av-emp', conv.kind === 'external' && 'is-ext')}
        />
        {conv.presence ? (
          <span className={cn('off-ws-pres', PRESENCE_CLASS[conv.presence])} />
        ) : null}
      </span>
    );
  }
  return (
    <span className={cn(avatarClass, 'is-group')}>
      <Icon icon={Bot} size="sm" />
    </span>
  );
}

function ConvRow({
  conv,
  active,
  employee,
  onSelect,
}: {
  conv: WsConversation;
  active: boolean;
  employee: Employee | null;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn('off-ws-im-row off-focusable', active && 'is-active')}
      onClick={onSelect}
    >
      <ConvAvatar conv={conv} employee={employee} />
      <span className="off-ws-im-main">
        <span className="off-ws-im-l1">
          <span className="off-ws-im-name">{conv.title}</span>
          {conv.kind === 'system' ? <span className="off-ws-im-tag">bot</span> : null}
          {conv.kind === 'external' ? <span className="off-ws-im-tag">ext</span> : null}
          <span className="off-ws-im-time">{conv.timeLabel}</span>
        </span>
        <span className="off-ws-im-l2">
          <span className="off-ws-im-snip">{conv.snippet}</span>
          {conv.unread ? <span className="off-ws-im-nb">{conv.unread}</span> : null}
          {!conv.unread && conv.read ? (
            <span className="off-ws-im-rd">
              <Icon icon={Check} size="sm" />
            </span>
          ) : null}
          {!conv.unread && conv.muted ? (
            <span className="off-ws-im-mute">
              <Icon icon={Megaphone} size="sm" />
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function ReasoningTag() {
  return (
    <span className="off-ws-reasoning">
      <Icon icon={ChevronRight} size="sm" />
      Reasoning
    </span>
  );
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
            <span className="off-ws-dlv-meta">{card.meta}</span>
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
        <Button
          variant="ghost"
          size="sm"
          className="off-ws-dlv-btn off-focusable"
          disabled={Boolean(disabledReason) || busyAction !== null}
          title={disabledTitle}
          onClick={() => void persistDeliverable('open')}
        >
          {busyAction === 'open' ? 'Opening…' : 'Open'}
        </Button>
        <span className="off-ws-dlv-fmt" title="Export format">
          {card.format}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="off-ws-dlv-btn off-focusable"
          disabled={Boolean(disabledReason) || busyAction !== null}
          title={disabledTitle}
          onClick={() => void persistDeliverable('export')}
        >
          {busyAction === 'export' ? 'Exporting…' : 'Export'}
        </Button>
      </div>
    </div>
  );
}

function RunRecordInline({ run }: { run: WsRunRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('off-ws-run', open && 'is-open')}>
      <button
        type="button"
        className="off-ws-run-head off-focusable"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={Terminal} size="sm" className="off-ws-run-ico" />
        <span className="off-ws-run-title">Run record</span>
        <span className="off-ws-run-meta">{run.meta}</span>
        <span className="off-ws-run-cost">{run.costLabel}</span>
        <Icon icon={ChevronRight} size="sm" className="off-ws-run-caret" />
      </button>
      {open && run.activity.length > 0 ? (
        <div className="off-ws-run-body">
          <div className="off-ws-run-sec-head">Activity</div>
          <div className="off-ws-act-entries">
            {run.activity.map((entry) => (
              <div key={entry.id} className={cn('off-ws-act-entry', `is-${entry.level}`)}>
                <Icon icon={entry.level === 'warning' ? AlertTriangle : Terminal} size="sm" />
                <span>{entry.detail}</span>
                {entry.repeat && entry.repeat > 1 ? (
                  <span className="off-ws-act-x">×{entry.repeat}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
        {message.reasoning ? <ReasoningTag /> : null}
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

function SystemChannel({
  cards,
  onOpenActivity,
}: { cards: SysCard[]; onOpenActivity: () => void }) {
  return (
    <>
      <header className="off-ws-chat-head">
        <span className="off-ws-ch-av is-bot">
          <Icon icon={Sparkles} size="sm" />
        </span>
        <div className="off-ws-crumb">
          <span className="off-ws-crumb-title">System</span>
          <span className="off-ws-crumb-sub">Notifications · runtime · hr · market · install</span>
        </div>
        <div className="off-ws-chat-tools">
          <IconButton
            icon={Terminal}
            label="Open Activity Log"
            variant="ghost"
            size="iconSm"
            onClick={onOpenActivity}
          />
        </div>
      </header>
      <div className="off-ws-conv-scroll">
        <section className="off-ws-messages is-sys">
          <span className="off-ws-day-sep">Today</span>
          {cards.map((card) => {
            const LevelIcon = SYS_LEVEL_ICON[card.level];
            const SourceIcon = SYS_SOURCE_ICON[card.source];
            return (
              <div key={card.id} className={cn('off-ws-sys-card', `is-${card.level}`)}>
                <span className="off-ws-sys-ic">
                  <Icon
                    icon={card.source === 'hr' || card.source === 'market' ? SourceIcon : LevelIcon}
                    size="sm"
                  />
                </span>
                <div className="off-ws-sys-main">
                  <div className="off-ws-sys-l1">
                    <span className="off-ws-sys-src">{SYS_SOURCE_LABEL[card.source]}</span>
                    <span className="off-ws-sys-ttl">{card.title}</span>
                    <span className="off-ws-sys-tm">{card.timeLabel}</span>
                  </div>
                  <div className="off-ws-sys-msg">{card.message}</div>
                  {card.actions.length > 0 ? (
                    <div className="off-ws-sys-act">
                      {card.actions.map((action) => (
                        <span
                          key={action.id}
                          className={cn('off-ws-sys-chip', action.primary && 'is-primary')}
                          title="Action state is mirrored from Activity Log"
                        >
                          {action.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>
      </div>
      <div className="off-ws-composer is-readonly">
        <span className="off-ws-readonly-note">
          <Icon icon={Shield} size="sm" />
          System channel is read-only — actions live on each card
        </span>
      </div>
    </>
  );
}

function ConvTabs({
  conv,
  facet,
  onFacet,
}: {
  conv: WsConversation;
  facet: ConvFacet;
  onFacet: (f: ConvFacet) => void;
}) {
  const tabs: Array<{ key: ConvFacet; label: string; icon: typeof MessageSquare; count?: number }> =
    [
      { key: 'chat', label: 'Chat', icon: MessageSquare },
      { key: 'files', label: 'Files', icon: Paperclip, count: conv.fileCount },
    ];
  return (
    <div className="off-ws-conv-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={cn('off-ws-conv-tab off-focusable', facet === t.key && 'is-active')}
          onClick={() => onFacet(t.key)}
        >
          <Icon icon={t.icon} size="sm" />
          {t.label}
          {t.count ? <span className="off-ws-conv-ct">{t.count}</span> : null}
        </button>
      ))}
      <IconButton
        icon={Plus}
        label="Files shared in this thread"
        variant="ghost"
        size="iconSm"
        className="off-ws-conv-tab-add"
        onClick={() => onFacet('files')}
        title="Show files shared in this conversation"
      />
    </div>
  );
}

function FacetEmpty() {
  return (
    <EmptyState
      icon={Paperclip}
      title="No files yet"
      description="Files shared in this conversation appear here."
    />
  );
}

function WorkspaceAssistantThread({
  active,
  messages,
  daySep,
  run,
  byId,
  facet,
  modeClass,
  modelLabel,
  projectId,
  workspaceBound,
}: {
  active: WsConversation;
  messages: WsMessage[];
  daySep: string;
  run: WsRunRecord | null | undefined;
  byId: Map<string, Employee>;
  facet: ConvFacet;
  modeClass: string;
  modelLabel: string;
  projectId: string | null;
  workspaceBound: boolean;
}) {
  const [drafts, setDrafts] = useState<WsMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnabled = isTauriRuntime();
  const staged = useRunStore((s) => s.staged);
  const stageFiles = useRunStore((s) => s.stageFiles);
  const clearStaged = useRunStore((s) => s.clearStaged);
  const storageAvailable = useRunStore((s) => s.storageAvailable);
  const runtimeMessages = useMemo(() => [...messages, ...drafts], [messages, drafts]);

  // Aborts any in-flight provider request and resets the local request state.
  // Shared by the cancel action and the unmount cleanup so a conversation
  // switch (which remounts this keyed component) never orphans a live request.
  const abortInFlight = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const requestId = requestIdRef.current;
    if (requestId) {
      void import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('llm_fetch_abort', { requestId }).catch(() => undefined),
      );
    }
    requestIdRef.current = null;
  }, []);

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
    }));
    if (files.length) stageFiles(files);
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
            id: attached[0].id,
            name: attached[0].name,
            meta:
              attached.length > 1
                ? `${attached[0].sizeLabel} · ${attached.length} files staged`
                : attached[0].sizeLabel,
          }
        : undefined;
      setDrafts((prev) => [
        ...prev,
        {
          id: workspaceDraftId('workspace-user'),
          author: 'boss',
          employeeId: null,
          timeLabel: workspaceTimeLabel(),
          body: text,
          attachment: firstAttachment,
        },
      ]);
      clearStaged();
      const requestId = workspaceDraftId('workspace-provider');
      requestIdRef.current = requestId;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsSending(true);
      try {
        const response = await sendWorkspaceProviderMessage(text, requestId, controller.signal);
        setDrafts((prev) => [
          ...prev,
          {
            id: workspaceDraftId('workspace-assistant'),
            author: 'employee',
            employeeId: active.employeeId,
            role: active.kind === 'group' ? 'workspace' : undefined,
            timeLabel: workspaceTimeLabel(),
            body: response,
          },
        ]);
      } catch (error) {
        // An aborted request (cancel or conversation switch) is not a failure;
        // skip the error draft and toast so it does not surface as a bridge error.
        if (controller.signal.aborted) {
          return;
        }
        const messageText = safeErrorMessage(error);
        toast.error('Workspace provider send failed', { description: messageText });
        setDrafts((prev) => [
          ...prev,
          {
            id: workspaceDraftId('workspace-provider-error'),
            author: 'employee',
            employeeId: active.employeeId,
            role: 'runtime',
            timeLabel: workspaceTimeLabel(),
            body: `Provider bridge failed: ${messageText}`,
          },
        ]);
      } finally {
        if (!controller.signal.aborted) {
          requestIdRef.current = null;
          abortControllerRef.current = null;
          setIsSending(false);
        }
      }
    },
    [active.employeeId, active.kind, chatEnabled, clearStaged, staged],
  );
  const onCancel = useCallback(async () => {
    abortInFlight();
    setIsSending(false);
  }, [abortInFlight]);
  const runtime = useExternalStoreRuntime({
    messages: runtimeMessages,
    onNew,
    convertMessage: wsMessageToAssistant,
    isRunning: Boolean(run) || isSending,
    onCancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="off-ws-thread">
        {facet === 'chat' ? (
          <ThreadPrimitive.Viewport className="off-ws-conv-scroll">
            {runtimeMessages.length === 0 ? (
              <EmptyState
                icon={MessageSquarePlus}
                title="No messages"
                description="Send the first message to start."
              />
            ) : (
              <>
                <section className="off-ws-messages">
                  <span className="off-ws-day-sep">{daySep}</span>
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
                </section>
                {run ? <RunRecordInline run={run} /> : null}
              </>
            )}
          </ThreadPrimitive.Viewport>
        ) : (
          <div className="off-ws-conv-scroll">
            <div className="off-ws-facet-pad">
              <FacetEmpty />
            </div>
          </div>
        )}

        {facet === 'chat' ? (
          <ComposerPrimitive.Root className="off-ws-composer">
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
            <StagedAttachments />
            <div className="off-ws-composer-tools">
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
                variant="subtle"
                size="iconSm"
                title={
                  storageAvailable
                    ? 'Attach files to the workspace message'
                    : 'Attachment storage is unavailable; selected files will surface an error chip'
                }
                onClick={() => fileInput.current?.click()}
              />
              <span className="off-ws-comp-div" />
              <span className="off-ws-comp-pill is-model" title="Desktop provider profile">
                <Icon icon={Sparkles} size="sm" />
                {modelLabel} · Med
              </span>
              <span
                className={cn('off-ws-comp-pill is-mode', modeClass)}
                title="Session mode inherited from the active conversation"
              >
                <span className="off-ws-mode-dot" />
                {MODE_LABEL[active.mode ?? 'direct']}
              </span>
              <span className="off-grow" />
              <ComposerPrimitive.Send
                className="off-ws-send off-focusable"
                disabled={!chatEnabled || isSending}
                title={
                  chatEnabled
                    ? 'Send message through runtime provider'
                    : 'Workspace chat requires the release desktop runtime'
                }
              >
                Send
                <Icon icon={SendHorizontal} size="sm" />
              </ComposerPrimitive.Send>
            </div>
          </ComposerPrimitive.Root>
        ) : null}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function MessengerApp() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const setSurface = useUiState((s) => s.setSurface);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const conversations = useWsConversations();
  const employees = useEmployees();
  const projects = useProjects(companyId);
  const providerConfigs = useProviderConfigs();
  const systemCards = useWsSystemCards();
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<ConvFacet>('chat');

  const list = conversations.data ?? [];
  const activeId = selectedId ?? list[0]?.id ?? null;
  const active = list.find((c) => c.id === activeId) ?? null;
  const thread = useWsThread(active && active.kind !== 'system' ? activeId : null);

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.title.toLowerCase().includes(q) || c.snippet.toLowerCase().includes(q),
    );
  }, [list, query]);

  const pinned = filtered.filter((c) => c.section !== 'earlier');
  const earlier = filtered.filter((c) => c.section === 'earlier');
  const activeEmployee = active?.employeeId ? (byId.get(active.employeeId) ?? null) : null;
  const activeProject = projects.data?.find((p) => p.id === projectId) ?? null;
  const workspaceBound = Boolean(activeProject?.workspaceRoot);
  const baseMessages = thread.data?.messages ?? [];

  const isSystem = active?.kind === 'system';
  const isDirect = active?.kind === 'direct' || active?.kind === 'external';
  const mode = active?.mode ?? 'direct';
  const modeClass = `is-${mode}`;
  const runtimeModelLabel =
    providerConfigs.data?.find((config) => config.hasStoredKey)?.model ?? 'Runtime model';

  let detailBody: ReactNode;
  if (!active) {
    detailBody = (
      <EmptyState
        icon={MessageSquare}
        title="Select a chat"
        description="Pick a conversation from the list."
      />
    );
  } else if (isSystem) {
    detailBody = (
      <SystemChannel cards={systemCards.data ?? []} onOpenActivity={() => setSurface('activity')} />
    );
  } else {
    detailBody = (
      <>
        <header className="off-ws-chat-head">
          <ConvAvatar conv={active} employee={activeEmployee} size={30} />
          <div className="off-ws-crumb">
            <span className="off-ws-crumb-title">{active.title}</span>
            <span className="off-ws-crumb-sub">
              {active.kind === 'group'
                ? `Team thread · ${active.members ?? 0} members · ${active.workingNow ?? 0} working now`
                : `Direct · ${activeEmployee?.role ?? '—'} · ${
                    active.presence === 'working' ? 'Working now' : (active.presence ?? 'idle')
                  }`}
            </span>
          </div>
          <div className="off-ws-chat-tools">
            {isDirect ? (
              <IconButton
                icon={Eye}
                label="View in Personnel"
                variant="ghost"
                size="iconSm"
                onClick={() => {
                  if (active.employeeId) selectEmployee(active.employeeId);
                  setSurface('personnel');
                }}
              />
            ) : null}
          </div>
        </header>

        <ConvTabs conv={active} facet={facet} onFacet={setFacet} />

        <WorkspaceAssistantThread
          key={active.id}
          active={active}
          messages={baseMessages}
          daySep={thread.data?.daySep ?? 'Today'}
          run={thread.data?.run}
          byId={byId}
          facet={facet}
          modeClass={modeClass}
          modelLabel={runtimeModelLabel}
          projectId={projectId}
          workspaceBound={workspaceBound}
        />
      </>
    );
  }

  return (
    <>
      <div className="off-ws-list">
        <div className="off-ws-list-head">
          <span className="off-ws-list-title">Chats</span>
        </div>
        <div className="off-ws-list-search">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search people, groups, messages"
          />
        </div>
        <div className="off-ws-chats">
          {pinned.map((conv) => (
            <ConvRow
              key={conv.id}
              conv={conv}
              active={conv.id === activeId}
              employee={conv.employeeId ? (byId.get(conv.employeeId) ?? null) : null}
              onSelect={() => {
                selectItem(conv.id);
                setFacet('chat');
              }}
            />
          ))}
          {earlier.length > 0 ? (
            <>
              <div className="off-ws-im-sec">Earlier</div>
              {earlier.map((conv) => (
                <ConvRow
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  employee={conv.employeeId ? (byId.get(conv.employeeId) ?? null) : null}
                  onSelect={() => {
                    selectItem(conv.id);
                    setFacet('chat');
                  }}
                />
              ))}
            </>
          ) : null}
        </div>
      </div>

      <div className="off-ws-detail">{detailBody}</div>
    </>
  );
}
