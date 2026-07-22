import type { WorkspaceProvenance } from '@offisim/shared-types';
import type { ConversationStreamCheckpoint } from './run-context.js';

export interface ConversationRunProjectionRef {
  userMessageId: string;
  assistantMessageId: string;
  source: 'office' | 'workspace';
}

export function buildConversationStreamCheckpoint({
  projection,
  threadId,
  employeeId,
  runId,
  contentText,
  reasoningText,
  at,
  companyId,
  projectId,
  workspaceProvenance,
}: {
  projection: ConversationRunProjectionRef | null | undefined;
  threadId: string;
  employeeId: string | null;
  runId: string;
  contentText: string;
  reasoningText: string;
  at: number;
  companyId: string;
  projectId: string | null;
  workspaceProvenance?: WorkspaceProvenance;
}): ConversationStreamCheckpoint | undefined {
  const reasoning = reasoningText.trim();
  if (!projection || (!contentText && !reasoning && !workspaceProvenance)) return undefined;
  return {
    companyId,
    projectId,
    message: {
      id: projection.assistantMessageId,
      threadId,
      author: 'employee',
      employeeId,
      body: contentText,
      ...(reasoning ? { reasoning } : {}),
      at,
      replyToMessageId: projection.userMessageId,
      attemptId: runId,
      status: 'streaming',
      ...(workspaceProvenance ? { workspaceProvenance } : {}),
    },
  };
}
