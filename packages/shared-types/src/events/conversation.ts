export interface ConversationSynopsisUpdatedPayload {
  readonly summary: string;
  readonly version: number;
  readonly prunedMessageCount: number;
  readonly totalMessageCount: number;
}

export interface ConversationCompactCompletedPayload {
  readonly compactId: string;
  readonly compactVersion: number;
  readonly compactedNonSystemMessageCount: number;
  readonly keptTailNonSystemMessageCount: number;
  readonly preCompactMessageCount: number;
  readonly preCompactTokenCount: number;
}
