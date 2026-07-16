import { sql } from 'drizzle-orm';
import { agentRuns } from './schema.js';

/**
 * Select at most one root per thread: the latest root must itself be an exact
 * plain-Conversation Fresh-session candidate. Ranking before eligibility is
 * essential; otherwise an older failed root could reappear after a newer Turn.
 */
export function latestFreshSessionCandidateWhere(
  companyId: string,
  threadId: string,
  resettableCodes: readonly string[],
) {
  if (resettableCodes.length === 0) return sql`0`;
  const codeList = sql.join(
    resettableCodes.map((code) => sql`${code}`),
    sql`, `,
  );
  return sql`
    ${agentRuns.company_id} = ${companyId}
    AND ${agentRuns.thread_id} = ${threadId}
    AND ${agentRuns.run_id} = ${agentRuns.root_run_id}
    AND ${agentRuns.parent_run_id} IS NULL
    AND ${agentRuns.status} = 'failed'
    AND ${agentRuns.session_file} IS NULL
    AND ${agentRuns.runtime_context_json} IS NOT NULL
    AND json_valid(${agentRuns.runtime_context_json}) = 1
    AND json_type(${agentRuns.runtime_context_json}, '$.nativeSessionPrestartErrorCode') = 'text'
    AND json_extract(${agentRuns.runtime_context_json}, '$.nativeSessionPrestartErrorCode') IN (${codeList})
    AND COALESCE(json_type(${agentRuns.runtime_context_json}, '$.nativeSessionReset'), '') <> 'true'
    AND json_extract(${agentRuns.runtime_context_json}, '$.recoveryLane') = 'conversation'
    AND json_type(${agentRuns.runtime_context_json}, '$.conversationProjection') = 'object'
    AND json_type(${agentRuns.runtime_context_json}, '$.conversationProjection.userMessageId') = 'text'
    AND trim(json_extract(${agentRuns.runtime_context_json}, '$.conversationProjection.userMessageId')) <> ''
    AND json_type(${agentRuns.runtime_context_json}, '$.conversationProjection.assistantMessageId') = 'text'
    AND trim(json_extract(${agentRuns.runtime_context_json}, '$.conversationProjection.assistantMessageId')) <> ''
    AND json_extract(${agentRuns.runtime_context_json}, '$.conversationProjection.source') IN ('office', 'workspace')
    AND NOT EXISTS (
      SELECT 1
      FROM agent_runs AS newer
      WHERE newer.company_id = ${agentRuns.company_id}
        AND newer.thread_id = ${agentRuns.thread_id}
        AND newer.run_id = newer.root_run_id
        AND newer.parent_run_id IS NULL
        AND (
          newer.started_at > ${agentRuns.started_at}
          OR (
            newer.started_at = ${agentRuns.started_at}
            AND newer.run_id > ${agentRuns.run_id}
          )
        )
    )
  `;
}

/** Narrow the durable Fresh filter to one exact company/thread/source tuple. */
export function freshSessionSourceWhere(
  companyId: string,
  threadId: string,
  sourceRunId: string,
  resettableCodes: readonly string[],
) {
  return sql`
    (${latestFreshSessionCandidateWhere(companyId, threadId, resettableCodes)})
    AND ${agentRuns.run_id} = ${sourceRunId}
  `;
}
