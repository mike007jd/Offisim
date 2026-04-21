import type { InMemoryEventBus } from '@offisim/core/browser';
import type { RuntimeEvent } from '@offisim/shared-types';
import type {
  InteractionMode,
  InteractionModeChangedPayload,
  InteractionRequest,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
} from '@offisim/shared-types';
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { RuntimeBundle } from '../../lib/browser-runtime';
import { getInteractionFollowUp } from '../interaction-follow-up';
import {
  loadDefaultInteractionMode,
  persistDefaultInteractionMode,
} from '../interaction-mode-storage';
import type { LastFailedMessage } from '../last-failed-message';

export interface UseInteractionSyncResult {
  interactionMode: InteractionMode;
  pendingInteraction: InteractionRequest | null;
  setInteractionMode: (mode: InteractionMode) => void;
  respondToInteraction: (
    selectedOptionId: string,
    freeformResponse?: string,
  ) => Promise<string | undefined>;
  interactionModeRef: MutableRefObject<InteractionMode>;
  pendingInteractionRef: MutableRefObject<InteractionRequest | null>;
}

export function useInteractionSync({
  eventBus,
  runtime,
  runtimeRef,
  sendMessage,
  retryLastMessage,
  lastFailedMessageRef,
  setError,
}: {
  eventBus: InMemoryEventBus;
  runtime: RuntimeBundle | null;
  runtimeRef: MutableRefObject<RuntimeBundle | null>;
  sendMessage: (
    text: string,
    options?: {
      targetEmployeeId?: string;
      threadId?: string;
      entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
      conversationKey?: string;
    },
  ) => Promise<string | undefined>;
  retryLastMessage: () => Promise<string | undefined>;
  lastFailedMessageRef: MutableRefObject<LastFailedMessage | null>;
  setError: Dispatch<SetStateAction<string | null>>;
}): UseInteractionSyncResult {
  const [interactionMode, setInteractionModeState] = useState<InteractionMode>(
    loadDefaultInteractionMode,
  );
  const [pendingInteraction, setPendingInteraction] = useState<InteractionRequest | null>(null);

  const interactionModeRef = useRef(interactionMode);
  interactionModeRef.current = interactionMode;
  const pendingInteractionRef = useRef(pendingInteraction);
  pendingInteractionRef.current = pendingInteraction;

  useEffect(() => {
    const offRequested = eventBus.on(
      'interaction.requested',
      (event: RuntimeEvent<InteractionRequestedPayload>) => {
        setPendingInteraction(event.payload.request);
      },
    );
    const offResolved = eventBus.on(
      'interaction.resolved',
      (_event: RuntimeEvent<InteractionResolvedPayload>) => {
        setPendingInteraction(null);
      },
    );
    const offMode = eventBus.on(
      'interaction.mode.changed',
      (event: RuntimeEvent<InteractionModeChangedPayload>) => {
        setInteractionModeState(event.payload.nextMode);
      },
    );
    return () => {
      offRequested();
      offResolved();
      offMode();
    };
  }, [eventBus]);

  // Hydrate interaction state from runtime when it becomes ready — byte-identical
  // to pre-refactor: the post-init block re-asserted pending + mode.
  useEffect(() => {
    if (!runtime?.interactionService) return;
    const pending = pendingInteractionRef.current;
    if (pending) {
      runtime.interactionService.hydratePending(pending);
    }
    setInteractionModeState(runtime.interactionService.getMode());
    setPendingInteraction(runtime.interactionService.getPending());
  }, [runtime]);

  const setInteractionMode = useCallback(
    (mode: InteractionMode) => {
      setInteractionModeState(mode);
      persistDefaultInteractionMode(mode);
      runtimeRef.current?.interactionService?.setMode(mode);
    },
    [runtimeRef],
  );

  const respondToInteraction = useCallback(
    async (selectedOptionId: string, freeformResponse?: string): Promise<string | undefined> => {
      const runtime = runtimeRef.current;
      const interactionService = runtime?.interactionService;
      const pending = interactionService?.getPending() ?? pendingInteractionRef.current;
      if (!pending || !interactionService) return undefined;

      const resolved = await interactionService.resolve({
        interactionId: pending.interactionId,
        selectedOptionId,
        freeformResponse,
        respondedAt: Date.now(),
      });

      const followUp = getInteractionFollowUp(
        pending,
        { selectedOptionId },
        resolved?.skillInstallOutcome,
      );

      if (followUp.mode === 'message') {
        return followUp.message;
      }

      if (followUp.mode === 'retry_last_message' && lastFailedMessageRef.current) {
        setError(null);
        return retryLastMessage();
      }

      if (followUp.mode === 'resend_with_clarification' && lastFailedMessageRef.current) {
        const answer = freeformResponse?.trim();
        if (!answer) return undefined;
        const last = lastFailedMessageRef.current;
        setError(null);
        return sendMessage(`${last.text}\n\nUser clarification: ${answer}`, {
          targetEmployeeId: last.targetEmployeeId,
          threadId: last.threadId,
          entryMode: last.entryMode,
          conversationKey: last.conversationKey,
        });
      }
      return undefined;
    },
    [runtimeRef, lastFailedMessageRef, retryLastMessage, sendMessage, setError],
  );

  return {
    interactionMode,
    pendingInteraction,
    setInteractionMode,
    respondToInteraction,
    interactionModeRef,
    pendingInteractionRef,
  };
}
