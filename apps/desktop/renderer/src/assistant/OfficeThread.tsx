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
import { ConvOutputs } from '@/surfaces/office/rail/ConvOutputs.js';
import { MessageItem } from '@/surfaces/office/rail/MessageItem.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { ChevronDown, Cpu, MessageSquarePlus, Paperclip, SendHorizontal } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { StagedAttachments } from './composer/StagedAttachments.js';
import { ChatErrorBanner } from './parts/ChatErrorBanner.js';
import { MeetingRegion } from './parts/Meeting.js';
import { useRunStore } from './run-store.js';
import { useOfficeRuntime } from './runtime/useOfficeRuntime.js';

const SESSION_MODES: SessionMode[] = ['sop', 'direct', 'hil', 'yolo'];

interface OfficeThreadProps {
  threadId: string;
  runState: RunState;
  seedMessages: ChatMessage[];
  employeesById: Map<string, Employee>;
  deliverables: Deliverable[];
  scope: ThreadScope;
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

  return (
    <ComposerPrimitive.Root className="off-composer">
      <ComposerPrimitive.Input
        className="off-composer-input"
        placeholder="Message the team — / for commands, @ to mention, Enter to send"
        rows={2}
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
            const files = Array.from(e.target.files ?? []).map((f) => ({
              name: f.name,
              bytes: f.size,
            }));
            if (files.length) stageFiles(files);
            e.target.value = '';
          }}
        />
        <IconButton
          icon={Paperclip}
          label={storageAvailable ? 'Attach file' : 'Attachment storage unavailable'}
          variant="subtle"
          size="iconSm"
          disabled={!storageAvailable}
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
  modelLabel,
  projectName,
  attachmentsAvailable,
}: OfficeThreadProps) {
  const runtime = useOfficeRuntime({ threadId, seedMessages });
  const syncThread = useRunStore((s) => s.syncThread);

  // Bind the shared run-state store to this thread: seeds the pipeline / error /
  // meeting that the stage pill, Live axis and error banner all read.
  useEffect(() => {
    syncThread(threadId, runState);
  }, [threadId, runState, syncThread]);

  // Stop the advance timer when the conversation unmounts (e.g. navigating away
  // mid-run) so it doesn't keep ticking into a store no component reads.
  useEffect(() => () => useRunStore.getState().stop(), []);

  const messageCount = seedMessages.length;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="off-thread">
        <ThreadPrimitive.Viewport className="off-thread-viewport">
          {messageCount === 0 ? (
            <EmptyState
              icon={MessageSquarePlus}
              title="No messages yet"
              description="Send the first instruction to start this conversation."
            />
          ) : (
            <div className="off-messages">
              <ThreadPrimitive.Messages>
                {({ message }) => {
                  const custom = message.metadata?.custom as unknown as ChatMessage | undefined;
                  return custom ? (
                    <MessageItem message={custom} employeesById={employeesById} />
                  ) : null;
                }}
              </ThreadPrimitive.Messages>
            </div>
          )}
          <ChatErrorBanner />
          <MeetingRegion />
          {scope === 'team' ? (
            <ConvOutputs deliverables={deliverables} employeesById={employeesById} />
          ) : null}
        </ThreadPrimitive.Viewport>
        <OfficeComposer
          modelLabel={modelLabel}
          projectName={projectName}
          attachmentsAvailable={attachmentsAvailable}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
