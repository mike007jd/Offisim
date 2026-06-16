import type { ChatMessage, Deliverable, Employee, RunState } from '@/data/types.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { isDesktopProviderBridgeAvailable } from '@/lib/provider-bridge.js';
import { ConvOutputs } from '@/surfaces/office/rail/ConvOutputs.js';
import { MessageItem } from '@/surfaces/office/rail/MessageItem.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { listen } from '@tauri-apps/api/event';
import { MessageSquarePlus, Paperclip, SendHorizontal } from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { StagedAttachments } from './composer/StagedAttachments.js';
import { ChatErrorBanner } from './parts/ChatErrorBanner.js';
import { MeetingTray } from './parts/Meeting.js';
import { PermissionApprovalBar } from './parts/PermissionApprovalBar.js';
import { RunActivityStrip } from './parts/RunActivityStrip.js';
import { SkillInstallConfirmBar } from './parts/SkillInstallConfirmBar.js';
import { useRunStore } from './run-store.js';
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
  projectName: string;
  persistMessage?: (message: ChatMessage) => Promise<void>;
}

function OfficeComposer({
  projectName,
  deliverables,
  employeesById,
  employeeName,
}: {
  projectName: string;
  deliverables: Deliverable[];
  employeesById: Map<string, Employee>;
  /** Direct 1:1 threads address the employee by name; team threads stay generic. */
  employeeName: string | null;
}) {
  const stageFiles = useRunStore((s) => s.stageFiles);
  const storageAvailable = useRunStore((s) => s.storageAvailable);
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
    if (!isDesktopProviderBridgeAvailable()) return;
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
      <RunActivityStrip />
      <div className="off-composer-shell">
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
          {/* Passive meta labels stay adjacent (project · mode) so they never sit
              between two interactive controls. */}
          <span className="off-composer-meta">
            <span className="off-composer-context" title={projectName}>
              {projectName}
            </span>
            <span aria-hidden="true">·</span>
            <span className="off-composer-mode" title="Direct execution mode">
              Direct
            </span>
          </span>
          <ComposerPrimitive.Send className="off-composer-send off-focusable" aria-label="Send">
            <span>Send</span>
            <Icon icon={SendHorizontal} size="sm" />
          </ComposerPrimitive.Send>
        </div>
      </div>
      <div className="off-composer-drop-overlay" aria-hidden={!dragActive}>
        <Icon icon={Paperclip} size="sm" />
        <span>{storageAvailable ? 'Drop files to attach' : 'Attachment vault unavailable'}</span>
      </div>
    </ComposerPrimitive.Root>
  );
}

export function OfficeThread({
  threadId,
  companyId,
  projectId,
  runState,
  seedMessages,
  employeesById,
  deliverables,
  employeeId,
  projectName,
  persistMessage,
}: OfficeThreadProps) {
  const runtime = useOfficeRuntime({
    threadId,
    seedMessages,
    assigneeId: employeeId,
    companyId,
    projectId,
    persistMessage,
  });
  const syncThread = useRunStore((s) => s.syncThread);

  // Bind the shared run-state store to this thread: seeds the pipeline / error /
  // meeting that the stage pill and error banner both read.
  useEffect(() => {
    syncThread(threadId, runState);
  }, [threadId, runState, syncThread]);

  // Stop the run when this conversation unmounts (e.g. navigating away mid-run)
  // so it doesn't keep ticking into a store no component reads. Gate on the
  // active threadId so unmounting thread A cannot clobber a sibling thread B
  // that has already taken over the shared store.
  useEffect(
    () => () => {
      if (useRunStore.getState().threadId === threadId) useRunStore.getState().stop();
    },
    [threadId],
  );

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
          <ChatErrorBanner />
          <PermissionApprovalBar companyId={companyId} threadId={threadId} />
          <SkillInstallConfirmBar companyId={companyId} threadId={threadId} />
        </ThreadPrimitive.Viewport>
        <OfficeComposer
          projectName={projectName}
          deliverables={deliverables}
          employeesById={employeesById}
          employeeName={employeeId ? (employeesById.get(employeeId)?.name ?? null) : null}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
