export interface GraphNodeEnteredPayload {
  readonly nodeName: string;
  readonly chatConversationKey?: string;
  readonly chatRunId?: string;
}

export interface GraphNodeExitedPayload {
  readonly nodeName: string;
}
