// Connect (Collaboration) renderer data layer (PR-05).
//
// The ONE door from the Connect UI to the PR-02 CollaborationService — the
// company-scoped daily-chat aggregate (direct + group), FULLY isolated from the
// project-scoped `chat_threads` / `useWsConversations` path. Every read is a
// TanStack Query key here; every write is a mutation that goes through
// {@link CollaborationService} and invalidates the affected keys. The Connect
// surface never reads `useWsConversations` / `useWsThread` and never calls a
// project-chat repo.
//
// Mirrors the data/missions.ts convention: `reposOrNull()` is the single repo
// door, browser preview (no repos) returns empty (Connect is a real-backend
// surface — there is no fixture seam), and the service is built per call from the
// live repos with injected `now()` / `newId()` (so the schema is identical to the
// harness backend).

import { reposOrNull } from '@/data/adapters.js';
import {
  type CollaborationServiceRepos,
  type CollaborationThreadSummary,
  createCollaborationService,
  readSenderLabel,
} from '@offisim/core/browser';
import type { RuntimeRepositories } from '@offisim/core/browser';
import type {
  CollaborationMember,
  CollaborationMessage,
  CollaborationReplyPolicy,
} from '@offisim/shared-types';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * Connect query-key factory. Namespaced under `'connect'` so a Connect
 * invalidation can never collide with the legacy `['ws', ...]` project-chat keys
 * or the `['threads', projectId]` Office keys.
 */
export const connectKeys = {
  /** Active company threads (list view), newest activity first. */
  threads: (companyId: string | null) => ['connect', 'threads', companyId] as const,
  /** One thread's persisted message transcript (oldest → newest). */
  messages: (threadId: string | null) => ['connect', 'messages', threadId] as const,
  /** A thread's active members (group settings). */
  members: (threadId: string | null) => ['connect', 'members', threadId] as const,
};

// ---------------------------------------------------------------------------
// Service accessor
// ---------------------------------------------------------------------------

/** The collaboration repo subset the service needs, pulled off RuntimeRepositories. */
function collaborationServiceRepos(repos: RuntimeRepositories): CollaborationServiceRepos | null {
  const {
    collaborationThreads,
    collaborationMembers,
    collaborationMessages,
    collaborationReadState,
  } = repos;
  if (
    !collaborationThreads ||
    !collaborationMembers ||
    !collaborationMessages ||
    !collaborationReadState
  ) {
    return null;
  }
  return {
    collaborationThreads,
    collaborationMembers,
    collaborationMessages,
    collaborationReadState,
    asyncTransact: repos.asyncTransact,
  };
}

/**
 * Build the live CollaborationService from the renderer repos, or null in browser
 * preview / when the collaboration repos are unavailable. Injected `now()` /
 * `newId()` keep the live path on the SAME deterministic contract the harness
 * exercises.
 */
export async function getCollaborationService() {
  const repos = await reposOrNull();
  if (!repos) return null;
  const subset = collaborationServiceRepos(repos);
  if (!subset) return null;
  return createCollaborationService(subset, {
    newId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

/** A transcript message projected for the Connect view (PR-01 invariant shape). */
export interface ConnectViewMessage {
  id: string;
  /** 'boss' = the local user; an employee turn otherwise. */
  author: 'boss' | 'employee' | 'system';
  employeeId: string | null;
  /** Snapshotted author label (survives employee deletion). */
  senderLabel: string | null;
  body: string;
  status: CollaborationMessage['status'];
  /** Epoch ms for ordering + the merge step. */
  at: number;
  createdAt: string;
}

function messageToView(message: CollaborationMessage): ConnectViewMessage {
  const at = Date.parse(message.createdAt);
  return {
    id: message.messageId,
    author: message.senderType,
    employeeId: message.senderEmployeeId ?? null,
    senderLabel: readSenderLabel(message.metadataJson ?? null),
    body: message.body,
    status: message.status,
    at: Number.isFinite(at) ? at : 0,
    createdAt: message.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Active company collaboration threads (list view), ordered by real last
 * activity. Empty in browser preview / before a company is chosen. Requires only
 * an active COMPANY — never a project.
 */
export function useConnectThreads(companyId: string | null) {
  return useQuery<CollaborationThreadSummary[]>({
    queryKey: connectKeys.threads(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const service = await getCollaborationService();
      if (!service) return [];
      return service.listThreads(companyId);
    },
    enabled: companyId !== null,
  });
}

/**
 * One thread's full persisted transcript, oldest → newest (the view renders
 * top-to-bottom). Pages through `listMessages` until history is exhausted; a
 * Connect thread is a daily chat, not an unbounded log, so a bounded full read is
 * the simplest correct projection (live streaming bodies come from the PR-03
 * controller snapshot, merged in the view).
 */
export function useConnectMessages(threadId: string | null) {
  return useQuery<ConnectViewMessage[]>({
    queryKey: connectKeys.messages(threadId),
    queryFn: async () => {
      if (!threadId) return [];
      const service = await getCollaborationService();
      if (!service) return [];
      const out: ConnectViewMessage[] = [];
      let cursor = null as Awaited<ReturnType<typeof service.listMessages>>['nextCursor'];
      // `listMessages` is newest-first, keyset-paginated. Walk every page, then
      // reverse to oldest-first for the transcript. Bounded by a hard page ceiling
      // so a corrupt cursor can never spin forever.
      for (let pages = 0; pages < 200; pages += 1) {
        const page = await service.listMessages(threadId, cursor, 50);
        for (const m of page.messages) out.push(messageToView(m));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      out.sort((a, b) => a.at - b.at || a.createdAt.localeCompare(b.createdAt));
      return out;
    },
    enabled: threadId !== null,
  });
}

/** A thread's active members (group settings panel). */
export function useConnectMembers(threadId: string | null) {
  return useQuery<CollaborationMember[]>({
    queryKey: connectKeys.members(threadId),
    queryFn: async () => {
      if (!threadId) return [];
      const service = await getCollaborationService();
      if (!service) return [];
      return service.listMembers(threadId);
    },
    enabled: threadId !== null,
  });
}

// ---------------------------------------------------------------------------
// Invalidation glue
// ---------------------------------------------------------------------------

/**
 * Invalidate the queries a turn affects: the thread's transcript + the company
 * thread list (last-message snippet / ordering / unread). The Connect send path
 * (PR-03 controller) calls this after a turn settles so the persisted rows the
 * controller upserted become visible without a manual refetch. Exported as a
 * plain function so the controller-driving view can call it without a hook.
 */
export function invalidateConnectThread(
  queryClient: QueryClient,
  companyId: string | null,
  threadId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: connectKeys.messages(threadId) });
  void queryClient.invalidateQueries({ queryKey: connectKeys.threads(companyId) });
}

// ---------------------------------------------------------------------------
// Mutations — every write goes through CollaborationService
// ---------------------------------------------------------------------------

/**
 * Idempotently get-or-create the active direct thread for an employee. This is
 * the draft-materialization path (flow 1): the first message on a direct draft
 * calls this; a double-send returns the SAME thread (the DB partial-unique index
 * + the service's catch+reread guarantee it). Requires an active company only.
 */
export function useGetOrCreateDirect(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      employeeId,
      title,
    }: {
      employeeId: string;
      title?: string;
    }): Promise<string> => {
      if (!companyId) throw new Error('Starting a chat needs an active company.');
      const service = await getCollaborationService();
      if (!service) throw new Error('Starting a chat needs the desktop app.');
      const thread = await service.getOrCreateDirect(companyId, employeeId, { title });
      return thread.threadId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectKeys.threads(companyId) });
    },
  });
}

/** Create a group thread (≥1 employee + reply policy). Returns the new thread id. */
export function useCreateGroup(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      title,
      employeeIds,
      replyPolicy,
    }: {
      title: string;
      employeeIds: string[];
      replyPolicy: CollaborationReplyPolicy;
    }): Promise<string> => {
      if (!companyId) throw new Error('Creating a group needs an active company.');
      const service = await getCollaborationService();
      if (!service) throw new Error('Creating a group needs the desktop app.');
      const thread = await service.createGroup({
        companyId,
        title,
        employeeIds,
        replyPolicy,
      });
      return thread.threadId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectKeys.threads(companyId) });
    },
  });
}

/** Add / remove group members in one transaction. */
export function useUpdateMembers(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      addEmployeeIds,
      removeMemberIds,
    }: {
      threadId: string;
      addEmployeeIds?: string[];
      removeMemberIds?: string[];
    }) => {
      const service = await getCollaborationService();
      if (!service) throw new Error('Updating members needs the desktop app.');
      return service.updateMembers({ threadId, addEmployeeIds, removeMemberIds });
    },
    onSuccess: (_members, vars) => {
      void queryClient.invalidateQueries({ queryKey: connectKeys.members(vars.threadId) });
      void queryClient.invalidateQueries({ queryKey: connectKeys.threads(companyId) });
    },
  });
}

/** Archive / unarchive a thread. */
export function useArchiveThread(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, archived }: { threadId: string; archived: boolean }) => {
      const service = await getCollaborationService();
      if (!service) throw new Error('Archiving needs the desktop app.');
      if (archived) await service.archive(threadId);
      else await service.unarchive(threadId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectKeys.threads(companyId) });
    },
  });
}

/** Move a thread's read boundary (defaults to its latest message). */
export function useMarkRead(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, messageId }: { threadId: string; messageId?: string }) => {
      const service = await getCollaborationService();
      if (!service) return;
      await service.markRead(threadId, messageId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectKeys.threads(companyId) });
    },
  });
}
