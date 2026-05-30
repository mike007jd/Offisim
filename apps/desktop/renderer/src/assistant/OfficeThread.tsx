import { useUiState } from '@/app/ui-state.js';
import type { ChatMessage, Deliverable, Employee, RunState, ThreadScope } from '@/data/types.js';
import { SESSION_MODE_LABEL, type SessionMode } from '@/data/types.js';
import { Chip } from '@/design-system/grammar/Chip.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { isDesktopProviderBridgeAvailable } from '@/lib/provider-bridge.js';
import { ConvOutputs } from '@/surfaces/office/rail/ConvOutputs.js';
import { MessageItem } from '@/surfaces/office/rail/MessageItem.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { listen } from '@tauri-apps/api/event';
import { ChevronDown, Cpu, MessageSquarePlus, Paperclip, SendHorizontal } from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { StagedAttachments } from './composer/StagedAttachments.js';
import { ChatErrorBanner } from './parts/ChatErrorBanner.js';
import { MeetingTray } from './parts/Meeting.js';
import { useRunStore } from './run-store.js';
import { useOfficeRuntime } from './runtime/useOfficeRuntime.js';

const SESSION_MODES: SessionMode[] = ['direct', 'hil', 'yolo'];

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
  runState: RunState;
  seedMessages: ChatMessage[];
  employeesById: Map<string, Employee>;
  deliverables: Deliverable[];
  scope: ThreadScope;
  /** Employee holding this conversation's run (direct thread), shown on the pill. */
  employeeId: string | null;
  modelLabel: string;
  projectName: string;
  attachmentsAvailable: number;
}

function OfficeComposer({
  modelLabel,
  projectName,
  attachmentsAvailable,
}: {
  modelLabel: string;
  projectName: string;
  attachmentsAvailable: number;
}) {
  const sessionMode = useUiState((s) => s.sessionMode);
  const setSessionMode = useUiState((s) => s.setSessionMode);
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
    }));
    if (files.length) stageFiles(files);
  }

  const stageNativeFiles = useCallback(
    (payload: NativeDroppedFilesPayload) => {
      const files = (payload.files ?? [])
        .filter((file) => !file.is_directory)
        .map((file) => ({
          name: file.name,
          bytes: file.bytes,
        }));
      if (files.length) stageFiles(files);
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
      <ComposerPrimitive.Input
        className="off-composer-input"
        placeholder="Message the team — / for commands, @ to mention, Enter to send"
        rows={1}
        submitOnEnter
      />
      <div className="off-ccs">
        <span className="off-ccs-project">{projectName}</span>
        <span className="off-ccs-dot" />
        <span className="off-ccs-att">{attachmentsAvailable} attachments available</span>
      </div>
      <StagedAttachments />
      <div className="off-composer-tools">
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
          title={
            storageAvailable
              ? 'Attach files to the message'
              : 'Attachment storage is unavailable; selected files will surface an error chip'
          }
          onClick={() => fileInput.current?.click()}
        />
        <span className="off-composer-divider" aria-hidden />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip as="button" accent dotColor="var(--off-accent)">
              {SESSION_MODE_LABEL[sessionMode]}
              <Icon icon={ChevronDown} size="sm" />
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {SESSION_MODES.map((mode) => (
              <DropdownMenuItem key={mode} onSelect={() => setSessionMode(mode)}>
                {SESSION_MODE_LABEL[mode]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Chip as="span">
          <Icon icon={Cpu} size="sm" />
          {modelLabel} · Med
        </Chip>
        <span className="off-grow" />
        <ComposerPrimitive.Send className="off-composer-send off-focusable">
          Send
          <Icon icon={SendHorizontal} size="sm" />
        </ComposerPrimitive.Send>
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
  runState,
  seedMessages,
  employeesById,
  deliverables,
  scope,
  employeeId,
  modelLabel,
  projectName,
  attachmentsAvailable,
}: OfficeThreadProps) {
  const runtime = useOfficeRuntime({ threadId, seedMessages, assigneeId: employeeId });
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
        </ThreadPrimitive.Viewport>
        {scope === 'team' ? (
          <div className="off-thread-pitbar" aria-label="Thread pit">
            <MeetingTray />
            <ConvOutputs deliverables={deliverables} employeesById={employeesById} />
          </div>
        ) : null}
        <OfficeComposer
          modelLabel={modelLabel}
          projectName={projectName}
          attachmentsAvailable={attachmentsAvailable}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
