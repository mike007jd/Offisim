export interface HandoffInitiatedPayload {
  readonly handoffId: string;
  readonly threadId: string;
  readonly fromEmployeeId: string;
  readonly toEmployeeId: string;
  readonly reason: string;
  readonly taskRunId: string;
}

export interface HandoffCompletedPayload {
  readonly handoffId: string;
  readonly toEmployeeId: string;
  readonly taskRunId: string;
}
