export interface LastFailedMessage {
  text: string;
  targetEmployeeId?: string;
  threadId?: string;
  projectId?: string | null;
  entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
  conversationKey: string;
}

export interface FailedRunState extends LastFailedMessage {
  message: string;
}
