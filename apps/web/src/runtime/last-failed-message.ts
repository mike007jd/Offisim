export interface LastFailedMessage {
  text: string;
  targetEmployeeId?: string;
  threadId?: string;
  entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
  conversationKey: string;
}

export interface FailedRunState extends LastFailedMessage {
  message: string;
}

export function getFailedConversationKey(options: {
  threadId?: string;
  targetEmployeeId?: string;
}): string {
  return `${options.threadId ?? 'unscoped'}::${options.targetEmployeeId ?? 'team'}`;
}
