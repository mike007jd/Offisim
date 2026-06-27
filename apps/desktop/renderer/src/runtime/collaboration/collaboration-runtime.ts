// Production assembly for the collaboration turn controller (PR-03). Wires the
// controller from the live repos + CollaborationService + the Tauri transport,
// resolving each thread's runtime context (company name, participants with a
// MINIMAL persona summary, reply policy) from the repository layer. PR-05 imports
// `getCollaborationTurnController(companyId)` and the `collaboration-react` hook.
//
// The participant persona summary is intentionally minimal (name + role + a short
// expertise/communication line) — NOT the full Office system prompt. The Office
// hidden system prompt and any non-participant private memory are FORBIDDEN from
// the context packet (see collaboration-context.ts).

import { titleizeSlug } from '@/lib/utils.js';
import { createCollaborationService } from '@offisim/core/browser';
import type { EmployeeRow, RuntimeRepositories } from '@offisim/core/browser';
import type { CollaborationMessage } from '@offisim/shared-types';
import { getRepos } from '../repos.js';
import type { CollaborationParticipant } from './collaboration-context.js';
import { createTauriCollaborationTransport } from './collaboration-transport.js';
import {
  type CollaborationThreadContext,
  type CollaborationTurnController,
  createCollaborationTurnController,
} from './collaboration-turn-controller.js';

/** A short, identity-only persona summary for the context packet. Reads the same
 *  persona profile as the Office prompt but emits ONLY a one/two-line summary —
 *  never the full Office system prompt. */
function personaSummary(employee: EmployeeRow): string | null {
  let expertise = '';
  let communication = '';
  try {
    const parsed = employee.persona_json
      ? (JSON.parse(employee.persona_json) as { profile?: Record<string, unknown> })
      : null;
    const profile = parsed?.profile ?? {};
    const exp = profile.expertise;
    expertise = Array.isArray(exp)
      ? exp.filter((x) => typeof x === 'string').join(', ')
      : typeof exp === 'string'
        ? exp
        : '';
    communication = typeof profile.communication === 'string' ? profile.communication : '';
  } catch {
    /* a malformed persona_json degrades to no summary */
  }
  const parts: string[] = [];
  if (expertise) parts.push(`Expertise: ${expertise}`);
  if (communication) parts.push(`Communication: ${communication}`);
  return parts.length > 0 ? parts.join('. ') : null;
}

function toParticipant(employee: EmployeeRow): CollaborationParticipant {
  return {
    employeeId: employee.employee_id,
    name: employee.name || employee.employee_id,
    role: titleizeSlug(employee.role_slug),
    personaSummary: personaSummary(employee),
  };
}

function assertCollaborationRepos(repos: RuntimeRepositories): void {
  for (const required of [
    'collaborationThreads',
    'collaborationMembers',
    'collaborationMessages',
    'collaborationReadState',
    'collaborationTurns',
    'employees',
    'companies',
  ] as const) {
    if (!repos[required]) {
      throw new Error(`Cannot start collaboration runtime: repos.${required} is unavailable.`);
    }
  }
}

async function assembleController(): Promise<CollaborationTurnController> {
  const repos = await getRepos();
  assertCollaborationRepos(repos);
  const service = createCollaborationService(
    {
      collaborationThreads: repos.collaborationThreads!,
      collaborationMembers: repos.collaborationMembers!,
      collaborationMessages: repos.collaborationMessages!,
      collaborationReadState: repos.collaborationReadState!,
      asyncTransact: repos.asyncTransact,
    },
    { newId: () => crypto.randomUUID(), now: () => new Date().toISOString() },
  );

  const resolveThread = async (threadId: string): Promise<CollaborationThreadContext> => {
    const thread = await repos.collaborationThreads!.findById(threadId);
    if (!thread) throw new Error(`collaboration thread not found: ${threadId}`);
    const [company, members, allEmployees] = await Promise.all([
      repos.companies!.findById(thread.company_id).catch(() => null),
      repos.collaborationMembers!.listActiveByThread(threadId),
      repos.employees!.findByCompany(thread.company_id),
    ]);
    const byId = new Map(allEmployees.map((e) => [e.employee_id, e]));
    // Participants are the thread's ACTIVE employee members, in their join order
    // (the member list is already join-ordered). Identity context only.
    const participants: CollaborationParticipant[] = members
      .filter((m) => m.actor_type === 'employee' && m.employee_id)
      .map((m) => byId.get(m.employee_id as string))
      .filter((e): e is EmployeeRow => e != null)
      .map(toParticipant);
    return {
      threadId,
      companyId: thread.company_id,
      companyName: company?.name ?? '',
      title: thread.title,
      kind: thread.kind as 'direct' | 'group',
      replyPolicy: thread.reply_policy as CollaborationThreadContext['replyPolicy'],
      directEmployeeId: thread.direct_employee_id,
      roundSpeakerLimit: thread.round_speaker_limit,
      participants,
    };
  };

  const recentMessages = async (threadId: string): Promise<CollaborationMessage[]> => {
    const page = await service.listMessages(threadId, null, 50);
    return page.messages;
  };

  return createCollaborationTurnController({
    transport: createTauriCollaborationTransport(),
    service: {
      appendMessage: (input) => service.appendMessage(input),
      listMembers: async (threadId) => {
        const members = await service.listMembers(threadId);
        return members.map((m) => ({ employeeId: m.employeeId, actorType: m.actorType }));
      },
    },
    turns: repos.collaborationTurns!,
    messages: { update: (id, patch) => repos.collaborationMessages!.update(id, patch) },
    resolveThread,
    recentMessages,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  });
}

const controllerCache = new Map<string, Promise<CollaborationTurnController>>();

/** Resolve (and cache) the collaboration turn controller for a company. */
export function getCollaborationTurnController(
  companyId: string,
): Promise<CollaborationTurnController> {
  const cached = controllerCache.get(companyId);
  if (cached) return cached;
  const promise = assembleController().catch((err) => {
    controllerCache.delete(companyId);
    throw err;
  });
  controllerCache.set(companyId, promise);
  return promise;
}
