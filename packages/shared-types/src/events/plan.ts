export interface PlanCreatedPayload {
  readonly planId: string;
  readonly threadId: string;
  readonly summary: string;
  readonly steps: ReadonlyArray<{
    readonly stepIndex: number;
    readonly description: string;
    readonly taskCount: number;
    readonly tasks: ReadonlyArray<{
      readonly taskRunId: string;
      readonly taskType: string;
      readonly description: string;
      readonly employeeId?: string;
      readonly assigneeId: string;
      readonly assigneeName?: string;
      readonly assigneeKind?: 'employee';
    }>;
  }>;
}

export interface PlanStepStartedPayload {
  readonly planId: string;
  readonly stepIndex: number;
  readonly taskCount: number;
}

export interface PlanStepCompletedPayload {
  readonly planId: string;
  readonly stepIndex: number;
  readonly outputCount: number;
}

export interface PlanCompletedPayload {
  readonly planId: string;
  readonly totalSteps: number;
}
