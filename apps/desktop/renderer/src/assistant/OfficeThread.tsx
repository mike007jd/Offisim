import { isTauriRuntime } from '@/data/adapters.js';
import type { ChatMessage, Deliverable, Employee, RunState } from '@/data/types.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { ConvOutputs } from '@/surfaces/office/rail/ConvOutputs.js';
import { MessageItem } from '@/surfaces/office/rail/MessageItem.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useComposer,
  useComposerRuntime,
} from '@assistant-ui/react';
import { listen } from '@tauri-apps/api/event';
import { MessageSquarePlus, Paperclip, SendHorizontal, Square } from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ModeControl,
  ModelControl,
  ScopeControl,
  ThinkingControl,
} from './composer/ComposerControls.js';
import { ComposerLoopChip } from './composer/ComposerLoopChip.js';
import { ComposerTriggers } from './composer/ComposerTriggers.js';
import { LoopPicker } from './composer/LoopPicker.js';
import { StagedAttachments } from './composer/StagedAttachments.js';
import { useComposerAttachmentStore } from './composer/composer-attachment-store.js';
import {
  loopReferenceToken,
  useComposerLoopReferenceStore,
} from './composer/composer-loop-reference-store.js';
import { OfficeEnhanceButton } from './enhance/OfficeEnhanceButton.js';
import { ChatErrorBanner } from './parts/ChatErrorBanner.js';
import { MeetingTray } from './parts/Meeting.js';
import { PermissionApprovalBar } from './parts/PermissionApprovalBar.js';
import { RunActivityStrip } from './parts/RunActivityStrip.js';
import { isConversationRunActive, useConversationRun } from './runtime/conversation-run-react.js';
import { useOfficeRuntime } from './runtime/useOfficeRuntime.js';

function dragHasFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes('Files');
}

interface NativeDroppedFile {
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
}

/**
 * Send affordance supporting a Loop-chip-only message (PR-10: "empty text + Loop
 * chip → allow Send"). assistant-ui's `ComposerPrimitive.Send` disables on an empty
 * composer, so when the only content is a Loop chip we render a small custom Send
 * that seeds the loop token (clearing the non-empty gate) and sends; `onNew` strips
 * the seeded token and re-appends it once. With typed text it defers to the
 * standard `ComposerPrimitive.Send` (the no-Loop / has-text path is unchanged).
 */
function LoopAwareSend({ threadId }: { threadId: string }) {
  const reference = useComposerLoopReferenceStore((s) => s.byThread[threadId]);
  const text = useComposer((c) => c.text);
  const composer = useComposerRuntime();

  if (text.trim().length > 0 || !reference) {
    return (
      <ComposerPrimitive.Send className="off-composer-send off-focusable" aria-label="Send">
        <span>Send</span>
        <Icon icon={SendHorizontal} size="sm" />
      </ComposerPrimitive.Send>
    );
  }

  const chip = reference;
  return (
    <button
      type="button"
      className="off-composer-send off-focusable"
      aria-label="Run Loop"
      onClick={() => {
        composer.setText(loopReferenceToken(chip));
        composer.send();
      }}
    >
      <span>Run Loop</span>
      <Icon icon={SendHorizontal} size="sm" />
    </button>
  );
}

function OfficeComposer({
  threadId,
  projectName,
  deliverables,
  employeesById,
  employeeName,
  scopeEmployeeId,
  isDraft,
}: {
  threadId: string;
  projectName: string;
  deliverables: Deliverable[];
  employeesById: Map<string, Employee>;
  /** Direct 1:1 threads address the employee by name; team threads stay generic. */
  employeeName: string | null;
  /** Current conversation scope target (null = team thread). */
  scopeEmployeeId: string | null;
  /** A draft (pre-first-message) thread can still retarget its scope. */
  isDraft: boolean;
}) {
  const employees = useMemo(() => Array.from(employeesById.values()), [employeesById]);
  const run = useConversationRun(threadId);
  const isRunning = isConversationRunActive(run.phase);
  const stageFiles = useComposerAttachmentStore((s) => s.stageFiles);
  const storageAvailable = useComposerAttachmentStore((s) => s.storageAvailable);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  function stageFileList(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).map((f) => ({
      name: f.name,
      bytes: f.size,
      type: f.type,
      file: f,
    }));
    if (files.length) void stageFiles(files);
  }

  const stageNativeFiles = useCallback(
    (payload: NativeDroppedFilesPayload) => {
      const files = (payload.files ?? [])
        .filter((file) => !file.is_directory)
        .map((file) => ({
          name: file.name,
          bytes: file.bytes,
        }));
      if (files.length) void stageFiles(files);
    },
    [stageFiles],
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
      stageNativeFiles(event.payload);
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
        <ComposerTriggers employees={employees} />
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
            <ComposerLoopChip threadId={threadId} />
            <ComposerPrimitive.Input
              className="off-composer-input"
              placeholder={employeeName ? `Message ${employeeName}` : 'Message the team'}
              rows={1}
              submitOnEnter
            />
            <StagedAttachments />
            <div className="off-composer-footer">
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
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
              <div className="off-thread-pitbar" aria-label="Conversation outputs and follow-up">
                <MeetingTray />
                <ConvOutputs deliverables={deliverables} employeesById={employeesById} />
              </div>
              <div className="off-composer-controls">
                <span className="off-composer-context" title={projectName}>
                  {projectName}
                </span>
                <ScopeControl
                  isDraft={isDraft}
                  scopeEmployeeId={scopeEmployeeId}
                  employees={employees}
                />
                <ModelControl threadId={threadId} />
                <ThinkingControl threadId={threadId} />
                <OfficeEnhanceButton
                  threadId={threadId}
                  projectName={projectName}
                  scopeEmployeeId={scopeEmployeeId}
                  employees={employees}
                />
                <ModeControl threadId={threadId} />
                {isRunning ? (
                  <ComposerPrimitive.Cancel
                    className="off-composer-send is-stop off-focusable"
                    aria-label="Stop run"
                  >
                    <span>Stop</span>
                    <Icon icon={Square} size="sm" />
                  </ComposerPrimitive.Cancel>
                ) : (
                  <LoopAwareSend threadId={threadId} />
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
}: OfficeThreadProps) {
  const runtime = useOfficeRuntime({
    threadId,
    seedMessages,
    assigneeId: employeeId,
    companyId,
    projectId,
    persistMessage,
    materializeThread,
    employeesById,
  });
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
          threadId={threadId}
          projectName={projectName}
          deliverables={deliverables}
          employeesById={employeesById}
          employeeName={employeeId ? (employeesById.get(employeeId)?.name ?? null) : null}
          scopeEmployeeId={employeeId}
          isDraft={isDraft}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
