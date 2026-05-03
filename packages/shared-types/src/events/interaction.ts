import type { InteractionMode, InteractionRequest, InteractionResponse } from '../interactions.js';

export interface InteractionRequestedPayload {
  readonly request: InteractionRequest;
  readonly chatConversationKey?: string;
  readonly chatRunId?: string;
  /** Product-layer chat_threads.thread_id; mirrors `RunScope.threadId`. */
  readonly chatThreadId?: string | null;
}

export interface InteractionResolvedPayload {
  readonly request: InteractionRequest;
  readonly response: InteractionResponse;
  /**
   * RunScope re-emitted on resolve so listeners (`useInteractionSync`,
   * activity-feed mappers, follow-up dispatch) can scope the resolution to
   * the same chat run as the original request. `chatThreadId` lets the right
   * rail land follow-up messages on the correct thread without parsing
   * conversationKey.
   */
  readonly chatConversationKey?: string;
  readonly chatRunId?: string;
  readonly chatThreadId?: string | null;
}

export interface InteractionRestoredPayload {
  readonly request: InteractionRequest;
}

export interface InteractionModeChangedPayload {
  readonly previousMode: InteractionMode;
  readonly nextMode: InteractionMode;
}
