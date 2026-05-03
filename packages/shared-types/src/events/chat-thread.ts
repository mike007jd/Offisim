export type ChatThreadUpdateReason = 'created' | 'title' | 'archived';

export interface ChatThreadUpdatedPayload {
  readonly chatThreadId: string;
  readonly projectId: string;
  readonly reason: ChatThreadUpdateReason;
}
