import type { MeetingState } from '../states.js';

export interface MeetingStatePayload {
  readonly meetingId: string;
  readonly prev: MeetingState;
  readonly next: MeetingState;
  readonly participantIds: readonly string[];
}

export interface MeetingActionCreatedPayload {
  readonly meetingId: string;
  readonly actionItemId: string;
  readonly description: string;
  readonly assigneeEmployeeId: string;
  readonly priority: 'high' | 'medium' | 'low';
  readonly dependsOn: string[];
}
