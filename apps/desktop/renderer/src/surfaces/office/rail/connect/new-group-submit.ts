import type { CollaborationReplyPolicy } from '@offisim/shared-types';

export interface NewGroupSubmission {
  title: string;
  employeeIds: string[];
  replyPolicy: CollaborationReplyPolicy;
}

export interface NewGroupSubmissionActions {
  createGroup: (input: NewGroupSubmission) => Promise<string>;
  openThread: (threadId: string) => void;
  closeDialog: () => void;
}

/** Headless seam for the exact NewGroupDialog submit handler used by ConnectRail. */
export async function submitNewGroupFromDialog(
  input: NewGroupSubmission,
  actions: NewGroupSubmissionActions,
): Promise<string> {
  const threadId = await actions.createGroup(input);
  actions.openThread(threadId);
  actions.closeDialog();
  return threadId;
}
