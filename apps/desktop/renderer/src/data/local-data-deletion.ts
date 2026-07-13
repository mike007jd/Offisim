import { invokeCommand } from '@/lib/tauri-commands.js';
import { isTauriRuntime } from './adapters.js';

/**
 * Multi-table destructive deletion for the local SQLite database.
 *
 * This module owns the foreign-key delete order, attachment cleanup, and
 * workspace cleanup for removing a conversation or a whole company. It is kept
 * apart from the React Query / view-model layer so the table knowledge lives in
 * one place. Each deep delete runs as a single `local_db_execute_transaction`
 * Tauri command; the React Query hooks only call these functions and invalidate
 * cache.
 */

export interface LocalDbTransactionStatement {
  sql: string;
  params?: unknown[];
}

interface StoredAttachmentMeta {
  attachmentId: string;
  companyId: string;
  threadId: string;
}

export interface DeleteCompanyDeepResult {
  persisted: boolean;
  workspaceCleanupError?: string;
}

function localDbTransaction(statements: LocalDbTransactionStatement[]): Promise<void> {
  if (statements.length === 0) return Promise.resolve();
  return invokeCommand('local_db_execute_transaction', { statements });
}

function localErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Unknown error';
}

async function deleteCompanyWorkspace(companyId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeCommand('delete_company_workspace', { companyId });
}

async function deleteCompanyAttachments(companyId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeCommand('attachment_delete_company', { companyId });
}

function attachmentVaultRef(meta: StoredAttachmentMeta): string {
  return `attachment://${meta.companyId}/${meta.threadId}/${meta.attachmentId}`;
}

async function deleteThreadAttachments(
  threadId: string,
  companyId: string | null | undefined,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const metas = companyId
    ? await invokeCommand('attachment_list', { companyId, threadId })
    : (await invokeCommand('attachment_list_all')).filter((meta) => meta.threadId === threadId);
  await Promise.all(
    metas.map((meta) => invokeCommand('attachment_delete', { vaultRef: attachmentVaultRef(meta) })),
  );
}

export async function deleteConversationDeep(
  threadId: string,
  companyId?: string | null,
): Promise<void> {
  // Contract C-B (rows-first): delete the DB rows atomically FIRST, then clean up
  // attachment blobs best-effort. The reverse order could delete the blobs and
  // then fail the DB write, leaving rows that reference gone files (dangling refs).
  await localDbTransaction(conversationDeletionStatements(threadId));
  // Best-effort FS cleanup after the DB commit — a failure here orphans blobs the
  // DB no longer references (collectible), never a dangling reference.
  try {
    await deleteThreadAttachments(threadId, companyId);
  } catch {
    // attachment blobs orphaned; surfaced via the desktop GC, not a hard failure
  }
}

/** Delete one Mission aggregate. Criteria, attempts, evaluations, runtime session
 * links, and mission events are schema-owned ON DELETE CASCADE children. */
export async function deleteMissionDeep(missionId: string): Promise<void> {
  await localDbTransaction(missionDeletionStatements(missionId));
}

/** Atomically compensate a prepared Office Loop before its user message exists. */
export async function deleteMaterializedLoopSend(
  invocationId: string,
  missionId: string,
): Promise<void> {
  await localDbTransaction([
    { sql: 'DELETE FROM loop_invocations WHERE invocation_id = $1', params: [invocationId] },
    ...missionDeletionStatements(missionId),
  ]);
}

export function missionDeletionStatements(missionId: string): LocalDbTransactionStatement[] {
  return [{ sql: 'DELETE FROM mission WHERE mission_id = $1', params: [missionId] }];
}

export function conversationDeletionStatements(threadId: string): LocalDbTransactionStatement[] {
  return [
    { sql: 'DELETE FROM tool_permission_approvals WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM compact_summaries WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM node_summaries WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM file_history WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM interaction_history WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM active_thread_interactions WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM agent_events WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM agent_runs WHERE thread_id = $1', params: [threadId] },
    {
      sql: 'DELETE FROM deliverables WHERE thread_id = $1 OR chat_thread_id = $1',
      params: [threadId],
    },
    { sql: 'DELETE FROM pi_messages WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM runtime_events WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM meeting_sessions WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM mcp_audit_log WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM handoff_events WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM loop_invocations WHERE thread_id = $1', params: [threadId] },
    // Mission children (criteria, attempts, evaluations, session links, events)
    // are schema-owned ON DELETE CASCADE rows.
    { sql: 'DELETE FROM mission WHERE thread_id = $1', params: [threadId] },
    {
      sql: `DELETE FROM llm_calls
            WHERE thread_id = $1
               OR task_run_id IN (
                    SELECT task_run_id FROM task_runs WHERE thread_id = $1
                  )`,
      params: [threadId],
    },
    {
      sql: `DELETE FROM memory_entries
            WHERE source_thread_id = $1
               OR source_task_run_id IN (
                    SELECT task_run_id FROM task_runs WHERE thread_id = $1
                  )`,
      params: [threadId],
    },
    {
      sql: `DELETE FROM tool_calls
            WHERE task_run_id IN (
                    SELECT task_run_id FROM task_runs WHERE thread_id = $1
                  )`,
      params: [threadId],
    },
    { sql: 'DELETE FROM task_runs WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM graph_threads WHERE thread_id = $1', params: [threadId] },
    { sql: 'DELETE FROM chat_threads WHERE thread_id = $1', params: [threadId] },
  ];
}

export async function deleteCompanyDeep(companyId: string): Promise<DeleteCompanyDeepResult> {
  await localDbTransaction([
    { sql: 'DELETE FROM tool_permission_approvals WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM skills WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM compact_summaries WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM node_summaries WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM file_history WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM interaction_history WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM active_thread_interactions WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM agent_events WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM agent_runs WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM pi_messages WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM memory_entries WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM runtime_events WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM deliverables WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM meeting_sessions WHERE company_id = $1', params: [companyId] },
    {
      sql: `DELETE FROM mcp_audit_log
            WHERE thread_id IN (
                    SELECT thread_id FROM graph_threads WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    {
      sql: `DELETE FROM handoff_events
            WHERE thread_id IN (
                    SELECT thread_id FROM graph_threads WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    {
      sql: `DELETE FROM llm_calls
            WHERE thread_id IN (
                    SELECT thread_id FROM graph_threads WHERE company_id = $1
                  )
               OR task_run_id IN (
                    SELECT tr.task_run_id
                      FROM task_runs tr
                      JOIN graph_threads gt ON gt.thread_id = tr.thread_id
                     WHERE gt.company_id = $1
                  )`,
      params: [companyId],
    },
    {
      sql: `DELETE FROM tool_calls
            WHERE task_run_id IN (
                    SELECT tr.task_run_id
                      FROM task_runs tr
                      JOIN graph_threads gt ON gt.thread_id = tr.thread_id
                     WHERE gt.company_id = $1
                  )`,
      params: [companyId],
    },
    {
      sql: `DELETE FROM task_runs
            WHERE thread_id IN (
                    SELECT thread_id FROM graph_threads WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    {
      sql: `DELETE FROM chat_threads
            WHERE project_id IN (
                    SELECT project_id FROM projects WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    {
      sql: `DELETE FROM project_assignments
            WHERE project_id IN (
                    SELECT project_id FROM projects WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    { sql: 'DELETE FROM projects WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM graph_threads WHERE company_id = $1', params: [companyId] },
    {
      sql: `DELETE FROM employee_versions
            WHERE employee_id IN (
                    SELECT employee_id FROM employees WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    { sql: 'DELETE FROM employees WHERE company_id = $1', params: [companyId] },
    {
      sql: `DELETE FROM workstation_racks
            WHERE workstation_id IN (
                    SELECT workstation_id FROM workstations WHERE company_id = $1
                  )
               OR rack_id IN (
                    SELECT rack_id FROM racks WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    {
      sql: `DELETE FROM slots
            WHERE rack_id IN (
                    SELECT rack_id FROM racks WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    { sql: 'DELETE FROM workstations WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM racks WHERE company_id = $1', params: [companyId] },
    {
      sql: `DELETE FROM asset_bindings
            WHERE install_txn_id IN (
                    SELECT install_txn_id FROM install_transactions WHERE company_id = $1
                  )
               OR installed_asset_id IN (
                    SELECT ia.installed_asset_id
                      FROM installed_assets ia
                      JOIN installed_packages ip
                        ON ip.installed_package_id = ia.installed_package_id
                     WHERE ip.company_id = $1
                  )`,
      params: [companyId],
    },
    {
      sql: `DELETE FROM installed_assets
            WHERE installed_package_id IN (
                    SELECT installed_package_id FROM installed_packages WHERE company_id = $1
                  )`,
      params: [companyId],
    },
    { sql: 'DELETE FROM installed_packages WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM install_transactions WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM company_template_assets WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM office_layouts WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM library_documents WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM prefab_instances WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM zones WHERE company_id = $1', params: [companyId] },
    { sql: 'DELETE FROM companies WHERE company_id = $1', params: [companyId] },
  ]);

  // FS-after-DB (contract C-B): rows are gone; remove the company's attachment
  // subtree + workspace dir best-effort. A failure here is a collectible orphan,
  // never a dangling reference.
  let cleanupError: string | undefined;
  try {
    await deleteCompanyAttachments(companyId);
  } catch (error) {
    cleanupError = localErrorMessage(error);
  }
  try {
    await deleteCompanyWorkspace(companyId);
  } catch (error) {
    cleanupError = cleanupError ?? localErrorMessage(error);
  }
  return cleanupError
    ? { persisted: true, workspaceCleanupError: cleanupError }
    : { persisted: true };
}
