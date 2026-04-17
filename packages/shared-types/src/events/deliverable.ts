import type { RoleSlug } from '../roles.js';

export interface DeliverableCreatedPayload {
  readonly deliverableId: string;
  readonly threadId: string;
  readonly title: string;
  readonly content: string;
  readonly kind?: 'document' | 'file';
  readonly fileName?: string | null;
  readonly mimeType?: string | null;
  readonly contributingEmployees: ReadonlyArray<{
    readonly employeeId: string;
    readonly employeeName: string;
    readonly sourceKind?: 'employee' | 'department';
    readonly roleSlug: RoleSlug;
  }>;
  readonly createdAt: number;
}
