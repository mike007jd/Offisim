import { AIMessage } from '@langchain/core/messages';
import {
  deliverableCreated,
  employeeStateChanged,
  taskAssignmentChanged,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { CitationRef, OffisimGraphState } from '../graph/state.js';
import type { LlmResponse } from '../llm/gateway.js';
import { type VerifyOutcome, verifyCompletion } from '../runtime/completion-verifier.js';
import type { TaskCompletionVerifyingPayload } from '../runtime/hook-registry.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { CitationEntry } from '../services/library-service.js';
import { Logger } from '../services/logger.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import {
  buildEmployeeDeliverableTitle,
  materializeFileDeliverableIfNeeded,
} from './employee-deliverables.js';
import type { MaterializedEmployeeDeliverable } from './employee-deliverables.js';
import { TASK_TYPE_HANDOFF_CONTINUATION } from './employee-node-constants.js';
import type { PreflightResult } from './employee-preflight.js';

const logger = new Logger('employee-completion');

async function verifyTaskCompletion(input: {
  runtimeCtx: RuntimeContext;
  taskRunId: string;
  employeeId: string;
  state: OffisimGraphState;
}): Promise<VerifyOutcome> {
  const { runtimeCtx, taskRunId, employeeId, state } = input;
  const defaultOutcome = verifyCompletion({
    recentToolResults: state.recentToolResults ?? [],
  });
  let hookOutcome: VerifyOutcome | null = null;
  const payload: TaskCompletionVerifyingPayload = {
    taskRunId,
    employeeId,
    recentToolResults: state.recentToolResults ?? [],
    allow: () => {
      hookOutcome = { ok: true };
    },
    block: (reason) => {
      hookOutcome = { ok: false, reason };
    },
  };
  await runtimeCtx.hookRegistry.emit(
    'task.completion.verifying',
    payload as unknown as Record<string, unknown>,
  );
  return hookOutcome ?? defaultOutcome;
}

/**
 * Extract [N] citation references from an LLM response and map them
 * back to the citation entries that were injected into the prompt.
 * Returns only citations that were actually referenced in the text.
 */
export function extractUsedCitations(
  responseText: string,
  citationMap: CitationEntry[],
): CitationRef[] {
  if (citationMap.length === 0 || !responseText) return [];
  const usedIndices = new Set<number>();
  const re = /\[(\d+)]/g;
  let m = re.exec(responseText);
  while (m !== null) {
    usedIndices.add(Number(m[1]));
    m = re.exec(responseText);
  }
  return citationMap
    .filter((c) => usedIndices.has(c.index))
    .map((c) => ({
      index: c.index,
      docTitle: c.docTitle,
      docId: c.docId,
      snippet: c.snippet,
    }));
}

export interface FinalizeSuccessContext {
  readonly runtimeCtx: RuntimeContext;
  readonly state: OffisimGraphState;
  readonly preflight: PreflightResult;
  readonly llmResponse: LlmResponse;
  readonly citationMap: CitationEntry[];
  readonly source: 'normal' | 'recovery';
  readonly round: number;
  readonly signal: AbortSignal | undefined;
  readonly materializedDeliverableOverride?: MaterializedEmployeeDeliverable | null;
  readonly skipVerification?: boolean;
}

/**
 * Shared completion path used by both happy-path and recovery-path.
 *
 * Side effects (in order):
 *   1. Materialize file deliverable if the response contains one (`materializeFileDeliverableIfNeeded`)
 *   2. Update task run status → `completed` with output JSON
 *   3. Emit `task.state.changed(running→completed)` + `task.assignment.changed(→unassigned)`
 *   4. Emit `task.subtask.progress(done)`
 *   5. Emit `employee.state.changed(executing→idle)`
 *   6. (normal only — and never for direct-chat / handoff-continuation) reflectAndRemember
 *   7. Extract citations from response
 *   8. `appendAgentEvent(action)` — payload differs by `source`
 *   9. `hookRegistry.emit('task.completed')` — completionType differs by `source`
 *   10. (normal only) write to scratchpad
 *   11. Emit `deliverable.created` if materialized
 *   12. Return `Partial<OffisimGraphState>` with final assistant message + step output entry
 */
export async function finalizeEmployeeSuccess(
  ctx: FinalizeSuccessContext,
): Promise<Partial<OffisimGraphState>> {
  const { runtimeCtx, state, preflight, llmResponse, citationMap, source, round, signal } = ctx;
  const {
    assignment,
    remaining,
    employee,
    taskRunId,
    taskLabel,
    totalAssignments,
    completedSoFar,
    isDirectChatTask,
    resolved,
    taskDescription,
  } = preflight;
  const { repos, eventBus, companyId, threadId, memoryService, scratchpad } = runtimeCtx;

  const completionOutcome = ctx.skipVerification
    ? ({ ok: true } as const)
    : taskRunId
      ? await verifyTaskCompletion({
          runtimeCtx,
          taskRunId,
          employeeId: employee.employee_id,
          state,
        })
      : ({ ok: false, reason: 'no-task-run-id' } as const);
  const nextTaskRunStatus = completionOutcome.ok ? 'completed' : 'blocked';
  const finalResponseContent = completionOutcome.ok
    ? llmResponse.content
    : `Task blocked: ${completionOutcome.reason}. Human review is required before this can be marked complete.`;

  const materializedDeliverable = completionOutcome.ok
    ? (ctx.materializedDeliverableOverride ??
      (await materializeFileDeliverableIfNeeded(
        runtimeCtx,
        taskDescription,
        employee,
        llmResponse,
        {
          model: resolved.model,
          provider: resolved.provider,
          temperature: resolved.temperature,
          maxTokens: resolved.maxTokens,
          signal,
        },
        taskRunId,
      )))
    : null;

  // Recovery path emits hookRegistry.emit INSIDE the taskRun update block
  // (pre-refactor order). Normal path fires it later, after appendAgentEvent.
  if (taskRunId) {
    await repos.taskRuns.updateStatus(
      taskRunId,
      nextTaskRunStatus,
      JSON.stringify({ content: finalResponseContent }),
    );
    eventBus.emit(
      taskStateChanged(
        companyId,
        taskRunId,
        'running',
        // review_ready is UI-only; SQLite task_runs.status persists the blocked state above.
        completionOutcome.ok ? 'completed' : 'review_ready',
        threadId,
        employee.employee_id,
        'employee',
        employee.name,
      ),
    );
    await repos.kanban.transitionByTaskRun(
      taskRunId,
      completionOutcome.ok ? 'done' : 'review',
      completionOutcome.ok ? null : completionOutcome.reason,
    );
    eventBus.emit(
      taskAssignmentChanged(companyId, taskRunId, employee.employee_id, 'unassigned', threadId, {
        employeeId: employee.employee_id,
        assigneeKind: 'employee',
        assigneeName: employee.name,
      }),
    );
    if (source === 'recovery' && completionOutcome.ok) {
      await runtimeCtx.hookRegistry.emit('task.completed', {
        threadId,
        companyId,
        employeeId: employee.employee_id,
        taskRunId,
        completionType: 'recovery',
      });
    }
  }

  eventBus.emit(
    taskSubtaskProgress(
      companyId,
      employee.employee_id,
      completedSoFar,
      taskLabel,
      completionOutcome.ok ? 'done' : 'failed',
      totalAssignments,
      completionOutcome.ok ? completedSoFar + 1 : completedSoFar,
      threadId,
      { employeeId: employee.employee_id, assigneeKind: 'employee', assigneeName: employee.name },
    ),
  );

  eventBus.emit(
    employeeStateChanged(companyId, employee.employee_id, 'executing', 'idle', threadId, taskRunId),
  );

  // reflectAndRemember runs only for normal path (recovery skipped — preserves
  // pre-refactor behavior where reflection was tied to happy-path only).
  if (completionOutcome.ok && source === 'normal' && memoryService) {
    const skipReflection =
      isDirectChatTask || assignment.taskType === TASK_TYPE_HANDOFF_CONTINUATION;
    try {
      await memoryService.reflectAndRemember(
        employee.employee_id,
        companyId,
        `Task: ${taskDescription}\n\nResponse: ${llmResponse.content}`,
        threadId,
        { skip: skipReflection, signal },
      );
    } catch (err) {
      logger.warn('reflectAndRemember failed', {
        error: err instanceof Error ? err.message : String(err),
        employeeId: employee.employee_id,
      });
    }
  }

  const usedCitations = completionOutcome.ok
    ? extractUsedCitations(llmResponse.content, citationMap)
    : [];

  if (!completionOutcome.ok) {
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `employee:${employee.employee_id}`,
      eventType: 'action',
      payload: {
        kind: 'completion-blocked',
        taskRunId,
        employeeName: employee.name,
        reason: completionOutcome.reason,
      },
    });
  } else if (source === 'normal') {
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `employee:${employee.employee_id}`,
      eventType: 'action',
      payload: {
        taskRunId,
        employeeName: employee.name,
        toolRounds: round,
        outputLength: llmResponse.content.length,
        citationCount: usedCitations.length,
      },
    });
    if (taskRunId) {
      await runtimeCtx.hookRegistry.emit('task.completed', {
        threadId,
        companyId,
        employeeId: employee.employee_id,
        taskRunId,
        completionType: 'response',
      });
    }
    scratchpad.write(
      `employee.last-output.${employee.employee_id}`,
      `${employee.name}: ${llmResponse.content.slice(0, 240)}`,
      'employee',
    );
  } else {
    // Recovery path: appendAgentEvent must not throw (pre-refactor guard).
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `employee:${employee.employee_id}`,
      eventType: 'action',
      payload: {
        taskRunId,
        employeeName: employee.name,
        recoveredFromError: true,
        outputLength: llmResponse.content.length,
      },
    }).catch(() => {});
  }

  if (materializedDeliverable) {
    runtimeCtx.eventBus.emit(
      deliverableCreated(
        runtimeCtx.companyId,
        generateId('del'),
        state.threadId,
        buildEmployeeDeliverableTitle(taskDescription, materializedDeliverable.fileName),
        materializedDeliverable.artifactContent,
        [
          {
            employeeId: employee.employee_id,
            employeeName: employee.name,
            sourceKind: 'employee',
            roleSlug: employee.role_slug,
          },
        ],
        {
          kind: 'file',
          fileName: materializedDeliverable.fileName,
          mimeType: materializedDeliverable.mimeType,
        },
      ),
    );
  }

  // Recovery path entry omits `citations` (preserve pre-refactor structure).
  const stepOutputEntry = {
    employeeId: employee.employee_id,
    employeeName: employee.name,
    sourceKind: 'employee' as const,
    roleSlug: employee.role_slug,
    content: finalResponseContent,
    taskRunId: taskRunId ?? '',
    stepIndex: preflight.stepIndex,
    artifact: materializedDeliverable
      ? {
          kind: 'file' as const,
          fileName: materializedDeliverable.fileName,
          mimeType: materializedDeliverable.mimeType,
          content: materializedDeliverable.artifactContent,
        }
      : undefined,
    ...(source === 'normal' && usedCitations.length > 0 ? { citations: usedCitations } : {}),
  };

  return {
    currentEmployeeId: employee.employee_id,
    currentTaskRunId: taskRunId ?? null,
    pendingAssignments: remaining,
    messages: [new AIMessage({ content: finalResponseContent })],
    currentStepOutputs: [...state.currentStepOutputs, stepOutputEntry],
    recentToolResults: state.recentToolResults ?? [],
  };
}
