export interface LastFailedMessage {
  text: string;
  targetEmployeeId?: string;
  threadId?: string;
  entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
}
