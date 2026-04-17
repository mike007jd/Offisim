import type { InteractionMode, InteractionRequest, InteractionResponse } from '../interactions.js';

export interface InteractionRequestedPayload {
  readonly request: InteractionRequest;
}

export interface InteractionResolvedPayload {
  readonly request: InteractionRequest;
  readonly response: InteractionResponse;
}

export interface InteractionRestoredPayload {
  readonly request: InteractionRequest;
}

export interface InteractionModeChangedPayload {
  readonly previousMode: InteractionMode;
  readonly nextMode: InteractionMode;
}
