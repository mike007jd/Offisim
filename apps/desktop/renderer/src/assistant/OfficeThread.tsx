import { isTauriRuntime } from '@/data/adapters.js';
import type { ChatMessage, Deliverable, Employee, RunState } from '@/data/types.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import type { AgentQueueBehavior } from '@/runtime/desktop-agent-runtime.js';
import { CapabilityManifest } from '@/surfaces/office/rail/CapabilityManifest.js';
import { ConvOutputs } from '@/surfaces/office/rail/ConvOutputs.js';
import { MessageItem } from '@/surfaces/office/rail/MessageItem.js';
import { useFirstRunState } from '@/surfaces/onboarding/first-run-state.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useComposer,
  useComposerRuntime,
} from '@assistant-ui/react';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { MessageSquarePlus, Paperclip, SendHorizontal, Square } from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DraftRecipientRow } from './composer/ComposerControls.js';
import { ComposerLoopChip } from './composer/ComposerLoopChip.js';
import { ComposerSettingsMenu } from './composer/ComposerSettingsMenu.js';
import { ComposerSkillChip } from './composer/ComposerSkillChip.js';
import { ComposerTriggers } from './composer/ComposerTriggers.js';
import { LoopPicker } from './composer/LoopPicker.js';
import { StagedAttachments } from './composer/StagedAttachments.js';
import {
  advanceComposerEditRevision,
  shouldClearAcceptedComposerText,
} from './composer/active-run-composer.js';
import {
  CHAT_ATTACHMENT_ACCEPT,
  type ComposerAttachmentScope,
  composerAttachmentScopeKey,
  useComposerAttachmentStore,
} from './composer/composer-attachment-store.js';
import {
  loopReferenceToken,
  useComposerLoopReferenceStore,
} from './composer/composer-loop-reference-store.js';
import {
  type ComposerSkillReference,
  skillReferenceToken,
  useComposerSkillReferenceStore,
} from './composer/composer-skill-reference-store.js';
import { OfficeEnhanceButton } from './enhance/OfficeEnhanceButton.js';
import { ChatErrorBanner } from './parts/ChatErrorBanner.js';
import { PermissionApprovalBar } from './parts/PermissionApprovalBar.js';
import { RunActivityStrip } from './parts/RunActivityStrip.js';
import { isConversationRunActive, useConversationRun } from './runtime/conversation-run-react.js';
import { ATTACHMENT_ONLY_PROMPT } from './runtime/desktop-chat-runtime.js';
import { useOfficeRuntime } from './runtime/useOfficeRuntime.js';

function dragHasFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes('Files');
}

interface NativeDroppedFile {
  path: string;
  name: string;
  bytes: number;
  is_directory?: boolean;
}

interface NativeDroppedFilesPayload {
  files?: NativeDroppedFile[];
  position?: {
    x: number;
    y: number;
  };
}

interface OfficeThreadProps {
  threadId: string;
  companyId: string | null;
  projectId: string | null;
  runState: RunState;
  seedMessages: ChatMessage[];
  employeesById: Map<string, Employee>;
  deliverables: Deliverable[];
  /** Employee holding this conversation's run (direct thread), shown on the pill. */
  employeeId: string | null;
  /** A draft (pre-first-message) thread whose scope can still be retargeted. */
  isDraft: boolean;
  projectName: string;
  persistMessage?: (message: ChatMessage) => Promise<void>;
  /**
   * Present only for an unsaved draft conversation: invoked with the first
   * message text to materialize the `chat_threads` row before that message is
   * persisted (deferred conversation creation).
   */
  materializeThread?: (firstUserText: string) => Promise<void>;
  /** Message selected from global search; consumed after the DOM anchor resolves. */
  focusedMessageId: string | null;
  onMessageFocusConsumed: () => void;
}

const EMPTY_SKILL_REFERENCES: ComposerSkillReference[] = [];

/**
 * Send affordance supporting reference-only messages. assistant-ui disables its
 * primitive Send on an empty composer, so a Loop or Skill-only turn briefly seeds
 * protected tokens; send-time projection rebuilds the persisted and engine text.
 */
function LoopAwareSend({
  threadId,
  hasAttachments,
}: { threadId: string; hasAttachments: boolean }) {
  const reference = useComposerLoopReferenceStore((s) => s.byThread[threadId]);
  const skillReferences = useComposerSkillReferenceStore(
    (s) => s.byThread[threadId] ?? EMPTY_SKILL_REFERENCES,
  );
  const text = useComposer((c) => c.text);
  const composer = useComposerRuntime();

  if (text.trim().length > 0 || (!reference && skillReferences.length === 0 && !hasAttachments)) {
    return (
      <ComposerPrimitive.Send className="off-composer-send off-focusable" aria-label="Send">
        <span>Send</span>
        <Icon icon={SendHorizontal} size="sm" />
      </ComposerPrimitive.Send>
    );
  }

  return (
    <button
      type="button"
      className="off-composer-send off-focusable"
      aria-label={reference ? 'Run Loop' : 'Send'}
      onClick={() => {
        const referenceTokens = reference
          ? loopReferenceToken(reference)
          : skillReferences.map(skillReferenceToken).join(' ');
        composer.setText(referenceTokens || ATTACHMENT_ONLY_PROMPT);
        composer.send();
      }}
    >
      <span>{reference ? 'Run Loop' : 'Send'}</span>
      <Icon icon={SendHorizontal} size="sm" />
    </button>
  );
}

function OfficeComposerInput({
  isRunning,
  shouldAutoFocus,
  employeeName,
  editRevision,
  onSend,
  onPasteImages,
}: {
  isRunning: boolean;
  shouldAutoFocus: boolean;
  employeeName: string | null;
  editRevision: { current: number };
  onSend: (text: string, behavior: AgentQueueBehavior) => Promise<boolean>;
  onPasteImages: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const text = useComposer((composer) => composer.text);
  const composer = useComposerRuntime();
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isRunning || event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing)
      return;
    event.preventDefault();
    const behavior: AgentQueueBehavior = event.altKey ? 'followUp' : 'steer';
    const submitted = { text, revision: editRevision.current };
    void onSend(submitted.text, behavior).then((accepted) => {
      const current = { text: composer.getState().text, revision: editRevision.current };
      if (shouldClearAcceptedComposerText(current, submitted, accepted)) composer.setText('');
    });
  };
  return (
    <ComposerPrimitive.Input
      className="off-composer-input"
      autoFocus={shouldAutoFocus}
      placeholder={
        isRunning
          ? 'Enter adjusts the current run · ⌥Enter queues next'
          : employeeName
            ? `Message ${employeeName}`
            : 'Message the team'
      }
      rows={1}
      submitOnEnter={!isRunning}
      onChange={() => advanceComposerEditRevision(editRevision)}
      onKeyDown={onKeyDown}
      onPaste={onPasteImages}
    />
  );
}

function ActiveRunControls({
  hasAttachments,
  hasSkillReferences,
  sending,
  editRevision,
  onSend,
}: {
  hasAttachments: boolean;
  hasSkillReferences: boolean;
  sending: AgentQueueBehavior | null;
  editRevision: { current: number };
  onSend: (text: string, behavior: AgentQueueBehavior) => Promise<boolean>;
}) {
  const text = useComposer((composer) => composer.text);
  const composer = useComposerRuntime();
  const send = async (behavior: AgentQueueBehavior) => {
    const submitted = { text, revision: editRevision.current };
    const accepted = await onSend(submitted.text, behavior);
    const current = { text: composer.getState().text, revision: editRevision.current };
    if (shouldClearAcceptedComposerText(current, submitted, accepted)) composer.setText('');
  };
  return (
    <>
      <button
        type="button"
        className="off-composer-send off-focusable"
        disabled={(!text.trim() && !hasAttachments && !hasSkillReferences) || sending !== null}
        title="Apply after the current tool call"
        onClick={() => void send('steer')}
      >
        Steer
      </button>
      <button
        type="button"
        className="off-composer-send off-focusable"
        disabled={(!text.trim() && !hasAttachments && !hasSkillReferences) || sending !== null}
        title="Run after the current turn"
        onClick={() => void send('followUp')}
      >
        Queue
      </button>
      <ComposerPrimitive.Cancel
        className="off-composer-send is-stop off-focusable"
        aria-label="Stop run"
      >
        <span>Stop</span>
        <Icon icon={Square} size="sm" />
      </ComposerPrimitive.Cancel>
    </>
  );
}

function OfficeComposer({
  attachmentScope,
  threadId,
  projectName,
  deliverables,
  sourceMessages,
  employeesById,
  employeeName,
  scopeEmployeeId,
  defaultModelSelector,
  isDraft,
  onSendWhileRunning,
}: {
  attachmentScope: ComposerAttachmentScope;
  threadId: string;
  projectName: string;
  deliverables: Deliverable[];
  sourceMessages: readonly ChatMessage[];
  employeesById: Map<string, Employee>;
  /** Direct 1:1 threads address the employee by name; team threads stay generic. */
  employeeName: string | null;
  /** Current conversation scope target (null = team thread). */
  scopeEmployeeId: string | null;
  /** Runtime selector bound to the scoped employee; absent for team threads. */
  defaultModelSelector?: string;
  /** A draft (pre-first-message) thread can still retarget its scope. */
  isDraft: boolean;
  onSendWhileRunning: (text: string, behavior: AgentQueueBehavior) => Promise<boolean>;
}) {
  const employees = useMemo(() => Array.from(employeesById.values()), [employeesById]);
  const initialPrompt = useFirstRunState((state) => state.draftPrompts[threadId] ?? null);
  const consumePrompt = useFirstRunState((state) => state.consumePrompt);
  const composer = useComposerRuntime();
  const run = useConversationRun(threadId);
  const isRunning = isConversationRunActive(run.phase);
  const stageFiles = useComposerAttachmentStore((s) => s.stageFiles);
  const storageAvailable = useComposerAttachmentStore((s) => s.storageAvailable);
  const hasAttachments = useComposerAttachmentStore((s) =>
    (s.stagedByScope[composerAttachmentScopeKey(attachmentScope)] ?? []).some(
      (attachment) => attachment.status === 'attached',
    ),
  );
  const hasSkillReferences = useComposerSkillReferenceStore(
    (state) => (state.byThread[threadId]?.length ?? 0) > 0,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const composerEditRevision = useRef(0);
  const dragDepth = useRef(0);
  const activeSendPendingRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeSendPending, setActiveSendPending] = useState<AgentQueueBehavior | null>(null);

  useEffect(() => {
    if (!initialPrompt) return;
    composer.setText(initialPrompt);
    consumePrompt(threadId);
  }, [composer, consumePrompt, initialPrompt, threadId]);

  const sendWhileRunning = useCallback(
    async (text: string, behavior: AgentQueueBehavior) => {
      if (activeSendPendingRef.current) return false;
      activeSendPendingRef.current = true;
      setActiveSendPending(behavior);
      try {
        return await onSendWhileRunning(text, behavior);
      } finally {
        activeSendPendingRef.current = false;
        setActiveSendPending(null);
      }
    },
    [onSendWhileRunning],
  );

  const stageFileList = useCallback(
    (fileList: FileList | readonly File[] | null) => {
      const files = Array.from(fileList ?? []).map((f) => ({
        name: f.name,
        bytes: f.size,
        type: f.type,
        file: f,
      }));
      if (files.length) void stageFiles(attachmentScope, files);
    },
    [attachmentScope, stageFiles],
  );

  const stagePastedImages = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const images = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (images.length === 0) return;
      event.preventDefault();
      stageFileList(images);
    },
    [stageFileList],
  );

  const stageNativeFiles = useCallback(
    async (payload: NativeDroppedFilesPayload) => {
      const files = (payload.files ?? [])
        .filter((file) => !file.is_directory)
        .map((file) => ({
          name: file.name,
          bytes: file.bytes,
          file: {
            arrayBuffer: async () => Uint8Array.from(await readFile(file.path)).buffer,
          },
        }));
      if (files.length) await stageFiles(attachmentScope, files);
    },
    [attachmentScope, stageFiles],
  );

  const nativeDropHitsComposer = useCallback((payload: NativeDroppedFilesPayload) => {
    if (!payload.position || !composerRef.current) return true;
    const rect = composerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const points = [
      payload.position,
      {
        x: payload.position.x / dpr,
        y: payload.position.y / dpr,
      },
    ];
    return points.some(
      (point) =>
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom,
    );
  }, []);

  useEffect(() => {
    // Native file-drop forwarding is a Tauri-only event bridge. Guard it so the
    // browser preview (no `__TAURI_INTERNALS__`) does not throw inside `listen`.
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<NativeDroppedFilesPayload>('offisim-native-file-drop', (event) => {
      if (!nativeDropHitsComposer(event.payload)) return;
      void stageNativeFiles(event.payload);
      dragDepth.current = 0;
      setDragActive(false);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [nativeDropHitsComposer, stageNativeFiles]);

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <div className="off-composer-trigger-host">
        <ComposerTriggers employees={employees} threadId={threadId} employeeId={scopeEmployeeId} />
        <LoopPicker />
        <ComposerPrimitive.Root
          ref={composerRef}
          className={`off-composer${dragActive ? ' is-drop-active' : ''}`}
          onDragEnter={(event) => {
            if (!dragHasFiles(event)) return;
            event.preventDefault();
            dragDepth.current += 1;
            setDragActive(true);
          }}
          onDragOver={(event) => {
            if (!dragHasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = storageAvailable ? 'copy' : 'none';
          }}
          onDragLeave={(event) => {
            if (!dragHasFiles(event)) return;
            event.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragActive(false);
          }}
          onDrop={(event) => {
            if (!dragHasFiles(event)) return;
            event.preventDefault();
            dragDepth.current = 0;
            setDragActive(false);
            stageFileList(event.dataTransfer.files);
          }}
        >
          <PermissionApprovalBar threadId={threadId} />
          <RunActivityStrip threadId={threadId} />
          <div className="off-composer-shell">
            {isDraft ? (
              <DraftRecipientRow scopeEmployeeId={scopeEmployeeId} employees={employees} />
            ) : null}
            <ComposerLoopChip threadId={threadId} />
            <ComposerSkillChip threadId={threadId} />
            <div className="off-composer-input-wrap">
              <OfficeComposerInput
                isRunning={isRunning}
                shouldAutoFocus={isDraft}
                employeeName={employeeName}
                editRevision={composerEditRevision}
                onSend={sendWhileRunning}
                onPasteImages={stagePastedImages}
              />
              <OfficeEnhanceButton
                threadId={threadId}
                projectName={projectName}
                scopeEmployeeId={scopeEmployeeId}
                employees={employees}
              />
            </div>
            <StagedAttachments scope={attachmentScope} />
            <div className="off-composer-footer">
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept={CHAT_ATTACHMENT_ACCEPT}
                onChange={(e) => {
                  stageFileList(e.target.files);
                  e.target.value = '';
                }}
              />
              <IconButton
                icon={Paperclip}
                label="Attach file"
                variant="subtle"
                size="iconSm"
                title={storageAvailable ? 'Attach file' : 'Attachment storage unavailable'}
                onClick={() => fileInput.current?.click()}
              />
              <div className="off-thread-pitbar" aria-label="Conversation panels">
                <CapabilityManifest threadId={threadId} employeeId={scopeEmployeeId} />
                <ConvOutputs
                  deliverables={deliverables}
                  employeesById={employeesById}
                  sourceMessages={sourceMessages}
                />
              </div>
              <div className="off-composer-controls">
                <ComposerSettingsMenu
                  threadId={threadId}
                  contextLabel={projectName}
                  defaultModelSelector={defaultModelSelector}
                />
                {isRunning ? (
                  <ActiveRunControls
                    hasAttachments={hasAttachments}
                    hasSkillReferences={hasSkillReferences}
                    sending={activeSendPending}
                    editRevision={composerEditRevision}
                    onSend={sendWhileRunning}
                  />
                ) : (
                  <LoopAwareSend threadId={threadId} hasAttachments={hasAttachments} />
                )}
              </div>
            </div>
          </div>
          <div className="off-composer-drop-overlay" aria-hidden={!dragActive}>
            <Icon icon={Paperclip} size="sm" />
            <span>
              {storageAvailable ? 'Drop files to attach' : 'Attachment vault unavailable'}
            </span>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}

export function OfficeThread({
  threadId,
  companyId,
  projectId,
  seedMessages,
  employeesById,
  deliverables,
  employeeId,
  isDraft,
  projectName,
  persistMessage,
  materializeThread,
  focusedMessageId,
  onMessageFocusConsumed,
}: OfficeThreadProps) {
  const attachmentScope = useMemo<ComposerAttachmentScope>(
    () => ({ companyId, projectId, threadId }),
    [companyId, projectId, threadId],
  );
  const { runtime, sendWhileRunning, messages } = useOfficeRuntime({
    threadId,
    seedMessages,
    assigneeId: employeeId,
    companyId,
    projectId,
    persistMessage,
    materializeThread,
    employeesById,
  });

  useEffect(() => {
    if (!focusedMessageId) return;
    let attempts = 0;
    let timer = 0;
    const reveal = () => {
      const target = document.getElementById(`off-message-${focusedMessageId}`);
      if (!target && attempts < 50) {
        attempts += 1;
        timer = window.setTimeout(reveal, 50);
        return;
      }
      if (target) {
        target.classList.remove('is-search-target');
        void target.offsetWidth;
        target.classList.add('is-search-target');
        target.scrollIntoView({ behavior: 'auto', block: 'center' });
        target.focus({ preventScroll: true });
        window.setTimeout(() => target.classList.remove('is-search-target'), 2_400);
      }
      onMessageFocusConsumed();
    };
    timer = window.setTimeout(reveal, 0);
    return () => window.clearTimeout(timer);
  }, [focusedMessageId, onMessageFocusConsumed]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="off-thread">
        <ThreadPrimitive.Viewport className="off-thread-viewport">
          <ThreadPrimitive.Empty>
            <EmptyState
              icon={MessageSquarePlus}
              title="No messages yet"
              description="Send the first instruction to start this conversation."
            />
          </ThreadPrimitive.Empty>
          <div className="off-messages">
            <ThreadPrimitive.Messages>
              {({ message }) => {
                const custom = message.metadata?.custom as unknown as ChatMessage | undefined;
                // While a send is in flight, assistant-ui drives an optimistic
                // assistant bubble that has no `metadata.custom` (the real reply
                // is appended to the external store on resolve). Returning null
                // for the custom===undefined case suppresses that placeholder so
                // it never renders alongside the real, store-backed message.
                return custom ? (
                  <MessageItem message={custom} employeesById={employeesById} />
                ) : null;
              }}
            </ThreadPrimitive.Messages>
          </div>
          <ChatErrorBanner threadId={threadId} />
        </ThreadPrimitive.Viewport>
        <OfficeComposer
          attachmentScope={attachmentScope}
          threadId={threadId}
          projectName={projectName}
          deliverables={deliverables}
          sourceMessages={messages}
          employeesById={employeesById}
          employeeName={employeeId ? (employeesById.get(employeeId)?.name ?? null) : null}
          scopeEmployeeId={employeeId}
          defaultModelSelector={
            employeeId ? employeesById.get(employeeId)?.model?.trim() || undefined : undefined
          }
          isDraft={isDraft}
          onSendWhileRunning={sendWhileRunning}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
