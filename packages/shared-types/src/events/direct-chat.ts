export interface DirectChatStartedPayload {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly threadId: string;
}

export interface DirectChatCompletedPayload {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly threadId: string;
}
