export interface ExecutionResumedPayload {
  readonly threadId: string;
  readonly currentStepIndex: number;
  readonly completedStepCount: number;
  readonly rewoundFromStepIndex: number | null;
  readonly skippedCompletedSteps: boolean;
  readonly updatedPlan: boolean;
}

export interface ExecutionAbortedPayload {
  readonly threadId: string;
  /** 'user' for a user-initiated stop, 'system' for programmatic aborts. */
  readonly reason: 'user' | 'system';
  readonly chatConversationKey?: string;
  readonly chatRunId?: string;
}

export interface ErrorOccurredPayload {
  readonly errorCode: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly nodeName: string;
  readonly employeeId?: string;
  readonly taskRunId?: string;
  readonly provider?: string;
  readonly model?: string;
}
