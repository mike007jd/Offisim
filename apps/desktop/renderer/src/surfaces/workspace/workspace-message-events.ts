import { loadPersistedChatMessages, persistChatMessage } from '@/data/chat-message-events.js';
import { loadThreadMessageEvents } from '@/data/thread-message-events.js';
import type { ChatAttachment, ChatMessage } from '@/data/types.js';
import { useQuery } from '@tanstack/react-query';
import type { WsMessage } from './workspace-data.js';

const WORKSPACE_CHAT_MESSAGE_EVENT = 'workspace_chat.message';

interface WorkspaceMessagePayload {
  message?: WsMessage;
  createdAtMs?: number;
}

type WorkspaceChatMessage = ChatMessage & {
  workspaceDeliverable?: WsMessage['deliverable'];
};

function extensionFromName(name: string): string {
  const [, ext] = /\.([^.]+)$/.exec(name) ?? [];
  return ext ? ext.toUpperCase() : 'FILE';
}

function wsAttachmentToChatAttachment(message: WsMessage): ChatAttachment[] | undefined {
  const attachments: ChatAttachment[] = [];
  if (message.attachment) {
    attachments.push({
      id: message.attachment.id,
      name: message.attachment.name,
      ext: extensionFromName(message.attachment.name),
      sizeLabel: message.attachment.meta,
    });
  }
  if (message.deliverable) {
    attachments.push({
      id: message.deliverable.id,
      name: message.deliverable.title,
      ext: message.deliverable.format,
      sizeLabel: message.deliverable.meta,
    });
  }
  return attachments.length ? attachments : undefined;
}

function workspaceTimeLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function workspaceMessageAt(message: WsMessage): number {
  if (message.at && Number.isFinite(message.at)) return message.at;
  const match = /^(\d{1,2}):(\d{2})$/.exec(message.timeLabel);
  const at = new Date();
  if (match) {
    at.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (at.getTime() > Date.now()) at.setDate(at.getDate() - 1);
    return at.getTime();
  }
  return Date.now();
}

function wsMessageToChatMessage(message: WsMessage, threadId: string): WorkspaceChatMessage {
  return {
    id: message.id,
    threadId,
    author: message.author,
    employeeId: message.employeeId,
    body: message.body,
    reasoning: message.reasoning,
    at: workspaceMessageAt(message),
    attachments: wsAttachmentToChatAttachment(message),
    workspaceDeliverable: message.deliverable,
  };
}

function chatMessageToWsMessage(message: ChatMessage): WsMessage {
  const workspaceMessage = message as WorkspaceChatMessage;
  const deliverable = workspaceMessage.workspaceDeliverable;
  const firstAttachment =
    message.attachments?.find((attachment) => attachment.id !== deliverable?.id) ??
    (deliverable ? undefined : message.attachments?.[0]);
  return {
    id: message.id,
    author: message.author === 'boss' ? 'boss' : 'employee',
    employeeId: message.author === 'boss' ? null : message.employeeId,
    role: message.author === 'system' ? 'runtime' : undefined,
    timeLabel: workspaceTimeLabel(new Date(message.at)),
    at: message.at,
    body: message.body,
    reasoning: message.reasoning,
    deliverable,
    attachment: firstAttachment
      ? {
          id: firstAttachment.id,
          name: firstAttachment.name,
          meta:
            message.attachments && message.attachments.length > 1
              ? `${firstAttachment.sizeLabel} · ${message.attachments.length} files staged`
              : firstAttachment.sizeLabel,
        }
      : undefined,
  };
}

function mergeWorkspaceMessages(...sources: WsMessage[][]): WsMessage[] {
  const merged = new Map<string, WsMessage>();
  for (const source of sources) {
    for (const message of source) {
      merged.set(message.id, message);
    }
  }
  return Array.from(merged.values()).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

export async function persistWorkspaceMessage({
  threadId,
  message,
  companyId,
  projectId,
}: {
  threadId: string;
  message: WsMessage;
  companyId: string | null;
  projectId: string | null;
}): Promise<void> {
  await persistChatMessage({
    message: wsMessageToChatMessage(message, threadId),
    companyId,
    projectId,
  });
}

async function loadPersistedWorkspaceMessages(threadId: string): Promise<WsMessage[]> {
  const [chatMessages, legacyEntries] = await Promise.all([
    loadPersistedChatMessages(threadId),
    loadThreadMessageEvents<{ message: WsMessage; createdAtMs: number }>(
      threadId,
      WORKSPACE_CHAT_MESSAGE_EVENT,
      (payload, row) => {
        const parsed = payload as WorkspaceMessagePayload;
        if (!parsed.message) return null;
        return {
          message: parsed.message,
          createdAtMs: parsed.createdAtMs ?? (Date.parse(row.created_at) || 0),
        };
      },
    ),
  ]);
  const canonicalMessages = chatMessages.map(chatMessageToWsMessage);
  const legacyMessages = legacyEntries.map((entry) =>
    entry.createdAtMs > 0 ? { ...entry.message, at: entry.createdAtMs } : entry.message,
  );
  return mergeWorkspaceMessages(legacyMessages, canonicalMessages);
}

export function usePersistedWorkspaceMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['ws', 'persisted-thread-messages', threadId],
    queryFn: () => loadPersistedWorkspaceMessages(threadId ?? ''),
    enabled: threadId !== null,
  });
}
