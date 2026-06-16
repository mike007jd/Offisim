export type ChatThreadUpdateReason = 'created' | 'title' | 'archived' | 'unarchived' | 'deleted';

export interface ChatThreadUpdatedPayload {
  readonly chatThreadId: string;
  readonly projectId: string;
  readonly reason: ChatThreadUpdateReason;
}
