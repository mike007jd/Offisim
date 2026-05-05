import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
import {
  CHAT_ATTACHMENT_GC_DROPPED,
  type ChatAttachmentGcReason,
  type VaultRef,
  chatAttachmentEvent,
  parseVaultRef,
} from '@offisim/shared-types';
import type { AttachmentStore } from '@offisim/ui-office/web';

const installed = new WeakSet<RuntimeRepositories>();

export interface AttachmentCascadeOptions {
  repos: RuntimeRepositories;
  attachmentStore: AttachmentStore;
  eventBus: EventBus | null;
}

function emitDropped(
  eventBus: EventBus | null,
  refs: readonly VaultRef[],
  reason: ChatAttachmentGcReason,
): void {
  if (!eventBus) return;
  for (const vaultRef of refs) {
    const parsed = parseVaultRef(vaultRef);
    const companyId = parsed.kind === 'ok' ? parsed.companyId : '';
    const threadId = parsed.kind === 'ok' ? parsed.threadId : '';
    const attachmentId = parsed.kind === 'ok' ? parsed.attachmentId : vaultRef;
    eventBus.emit(
      chatAttachmentEvent(
        CHAT_ATTACHMENT_GC_DROPPED,
        { entityId: attachmentId, companyId, threadId },
        { attachmentId, threadId, vaultRef, reason },
      ),
    );
  }
}

export function installAttachmentDeleteCascades(opts: AttachmentCascadeOptions): void {
  const { repos, attachmentStore, eventBus } = opts;
  if (installed.has(repos)) return;
  installed.add(repos);

  const baseChatDelete = repos.chatThreads.delete.bind(repos.chatThreads);
  const baseProjectDelete = repos.projects.delete.bind(repos.projects);
  const baseCompanyDelete = repos.companies.delete.bind(repos.companies);

  repos.chatThreads.delete = async (threadId: string) => {
    const thread = await repos.chatThreads.findById(threadId);
    const project = thread ? await repos.projects.findById(thread.project_id) : null;
    if (project) {
      const refs = await attachmentStore.deleteByThread(project.company_id, threadId);
      emitDropped(eventBus, refs, 'thread-deleted');
    }
    await baseChatDelete(threadId);
  };

  repos.projects.delete = async (projectId: string) => {
    const project = await repos.projects.findById(projectId);
    if (project) {
      const threads = await repos.chatThreads.listAllByProject(projectId);
      for (const thread of threads) {
        const refs = await attachmentStore.deleteByThread(project.company_id, thread.thread_id);
        emitDropped(eventBus, refs, 'project-deleted');
      }
      for (const thread of threads) {
        await baseChatDelete(thread.thread_id);
      }
    }
    await baseProjectDelete(projectId);
  };

  repos.companies.delete = async (companyId: string) => {
    const projects = await repos.projects.findByCompany(companyId);
    for (const project of projects) {
      const threads = await repos.chatThreads.listAllByProject(project.project_id);
      for (const thread of threads) {
        const refs = await attachmentStore.deleteByThread(companyId, thread.thread_id);
        emitDropped(eventBus, refs, 'company-deleted');
      }
      for (const thread of threads) {
        await baseChatDelete(thread.thread_id);
      }
      await baseProjectDelete(project.project_id);
    }
    await baseCompanyDelete(companyId);
  };
}
