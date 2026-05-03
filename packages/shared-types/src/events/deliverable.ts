import type { RoleSlug } from '../roles.js';

export interface DeliverableCreatedPayload {
  readonly deliverableId: string;
  readonly threadId: string;
  /**
   * Product-layer `chat_threads.thread_id` the deliverable belongs to.
   * Mirrors `RunScope.threadId`; lets right-rail consumers
   * (`useDeliverables`, PitchHall, DashboardOverlay) scope by chat thread
   * without parsing the conversationKey embedded in `threadId`. `null` for
   * non-chat-driven deliverables (background_sync, install_flow).
   */
  readonly chatThreadId?: string | null;
  readonly title: string;
  readonly content: string;
  readonly kind?: 'document' | 'file';
  readonly fileName?: string | null;
  readonly mimeType?: string | null;
  readonly contributingEmployees: ReadonlyArray<{
    readonly employeeId: string;
    readonly employeeName: string;
    readonly sourceKind?: 'employee';
    readonly roleSlug: RoleSlug;
    readonly isExternal: boolean;
    readonly brandKey: string | null;
  }>;
  readonly createdAt: number;
}
