export interface MemoryCreatedPayload {
  readonly memoryId: string;
  readonly employeeId: string;
  readonly scope: 'employee' | 'team' | 'company';
  readonly category: 'experience' | 'decision' | 'knowledge' | 'preference';
  readonly contentPreview: string;
}

export interface MemoryAccessedPayload {
  readonly memoryId: string;
  readonly employeeId: string;
  readonly query: string;
}
