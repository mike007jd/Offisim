import { AIMessage } from '@langchain/core/messages';
import { A2AClient } from '../a2a/a2a-client.js';
import type { A2APeer, A2ATask } from '../a2a/a2a-types.js';
import {
  deliverableCreated,
  employeeStateChanged,
  taskAssignmentChanged,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import { type EmployeeRow, employeeBrandFields } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { isUserRequestedDeliverableIntent } from './deliverable-intent.js';
import type { PreflightResult } from './employee-preflight.js';
import { inferDeliverableFile } from './infer-deliverable-file.js';

function decodeBase64Text(data: string): string {
  if (typeof atob === 'function') {
    return decodeURIComponent(
      Array.from(atob(data))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
  }
  const maybeBuffer = (
    globalThis as {
      Buffer?: { from(data: string, encoding: string): { toString(enc: string): string } };
    }
  ).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(data, 'base64').toString('utf8');
  }
  return data;
}

interface A2AOutput {
  readonly content: string;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly artifactBacked: boolean;
}

function extractOutput(task: A2ATask): A2AOutput {
  const parts = task.artifacts?.flatMap((artifact) => artifact.parts) ?? [];
  for (const part of parts) {
    if (part.raw) {
      return {
        content: decodeBase64Text(part.raw),
        fileName: part.filename ?? null,
        mimeType: part.mediaType ?? null,
        artifactBacked: true,
      };
    }
    if (part.text?.trim()) {
      return {
        content: part.text,
        fileName: part.filename ?? null,
        mimeType: part.mediaType ?? 'text/plain',
        artifactBacked: true,
      };
    }
  }
  const messageText =
    task.status.message?.parts
      .map((part) => part.text ?? '')
      .filter(Boolean)
      .join('\n\n') ?? '';
  return {
    content: messageText || 'External employee completed the task with no textual output.',
    fileName: null,
    mimeType: messageText ? 'text/plain' : null,
    artifactBacked: false,
  };
}

function peerFromEmployee(employee: EmployeeRow): A2APeer | null {
  const url = employee.a2a_url?.trim();
  if (!url) return null;
  return {
    name: employee.name,
    url,
    ...(employee.a2a_token ? { token: employee.a2a_token } : {}),
    ...(employee.a2a_agent_id ? { agentId: employee.a2a_agent_id } : {}),
  };
}

function emitProgress(
  runtimeCtx: RuntimeContext,
  employee: EmployeeRow,
  completedSoFar: number,
  totalAssignments: number,
  taskLabel: string,
  status: 'done' | 'failed',
  threadId: string,
): void {
  runtimeCtx.eventBus.emit(
    taskSubtaskProgress(
      runtimeCtx.companyId,
      employee.employee_id,
      completedSoFar,
      taskLabel,
      status,
      totalAssignments,
      status === 'done' ? completedSoFar + 1 : completedSoFar,
      threadId,
      {
        employeeId: employee.employee_id,
        assigneeKind: 'employee',
        assigneeName: employee.name,
      },
    ),
  );
}

async function markFailure(
  runtimeCtx: RuntimeContext,
  preflight: PreflightResult,
  threadId: string,
  code: string,
  message: string,
): Promise<void> {
  const { employee, taskRunId, completedSoFar, totalAssignments, taskLabel } = preflight;
  if (taskRunId) {
    await runtimeCtx.repos.taskRuns.updateStatus(
      taskRunId,
      'failed',
      JSON.stringify({ error: { code, message, source: 'a2a' } }),
    );
    runtimeCtx.eventBus.emit(
      taskStateChanged(
        runtimeCtx.companyId,
        taskRunId,
        'running',
        'failed',
        threadId,
        employee.employee_id,
        'employee',
        employee.name,
      ),
    );
  }
  emitProgress(
    runtimeCtx,
    employee,
    completedSoFar,
    totalAssignments,
    taskLabel,
    'failed',
    threadId,
  );
  runtimeCtx.eventBus.emit(
    employeeStateChanged(
      runtimeCtx.companyId,
      employee.employee_id,
      'executing',
      'idle',
      threadId,
      taskRunId,
    ),
  );
}

export async function runEmployeeA2A(
  state: OffisimGraphState,
  runtimeCtx: RuntimeContext,
  preflight: PreflightResult,
  signal?: AbortSignal,
): Promise<Partial<OffisimGraphState>> {
  const {
    employee,
    remaining,
    taskRunId,
    taskDescription,
    completedSoFar,
    totalAssignments,
    taskLabel,
  } = preflight;
  const { eventBus, companyId, threadId } = runtimeCtx;
  const peer = peerFromEmployee(employee);

  if (!peer) {
    await markFailure(
      runtimeCtx,
      preflight,
      threadId,
      'a2a_unconfigured',
      `External employee ${employee.name} is missing a2a_url`,
    );
    return { pendingAssignments: remaining, currentStepOutputs: state.currentStepOutputs };
  }

  const client = new A2AClient(peer);
  let task: A2ATask;
  try {
    task = await client.sendAndWait(taskDescription, {
      ...(peer.agentId ? { agentId: peer.agentId } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailure(runtimeCtx, preflight, threadId, 'a2a_transport', message);
    return { pendingAssignments: remaining, currentStepOutputs: state.currentStepOutputs };
  }

  if (task.status.state !== 'TASK_STATE_COMPLETED') {
    await markFailure(
      runtimeCtx,
      preflight,
      threadId,
      `a2a_${task.status.state.toLowerCase()}`,
      task.status.message?.parts
        .map((p) => p.text ?? '')
        .filter(Boolean)
        .join('\n\n') || `Remote task ended in state ${task.status.state}`,
    );
    return { pendingAssignments: remaining, currentStepOutputs: state.currentStepOutputs };
  }

  const output = extractOutput(task);
  const inferredFile = output.artifactBacked
    ? {
        kind: 'file' as const,
        fileName: output.fileName,
        mimeType: output.mimeType,
      }
    : isUserRequestedDeliverableIntent(taskDescription)
      ? inferDeliverableFile(taskDescription, output.content)
      : null;
  const normalizedArtifact = inferredFile
    ? {
        kind: 'file' as const,
        fileName: inferredFile.fileName ?? null,
        mimeType: inferredFile.mimeType ?? null,
      }
    : undefined;

  if (taskRunId) {
    await runtimeCtx.repos.taskRuns.updateStatus(
      taskRunId,
      'completed',
      JSON.stringify({ content: output.content }),
    );
    eventBus.emit(
      taskStateChanged(
        companyId,
        taskRunId,
        'running',
        'completed',
        threadId,
        employee.employee_id,
        'employee',
        employee.name,
      ),
    );
    eventBus.emit(
      taskAssignmentChanged(companyId, taskRunId, employee.employee_id, 'unassigned', threadId, {
        employeeId: employee.employee_id,
        assigneeKind: 'employee',
        assigneeName: employee.name,
      }),
    );
    await runtimeCtx.hookRegistry.emit('task.completed', {
      threadId,
      companyId,
      employeeId: employee.employee_id,
      taskRunId,
      completionType: 'response',
    });
  }

  emitProgress(runtimeCtx, employee, completedSoFar, totalAssignments, taskLabel, 'done', threadId);
  eventBus.emit(
    employeeStateChanged(companyId, employee.employee_id, 'executing', 'idle', threadId, taskRunId),
  );

  if (normalizedArtifact) {
    eventBus.emit(
      deliverableCreated(
        companyId,
        generateId('del'),
        threadId,
        normalizedArtifact.fileName ?? employee.name,
        output.content,
        [
          {
            employeeId: employee.employee_id,
            employeeName: employee.name,
            sourceKind: 'employee',
            roleSlug: employee.role_slug,
            ...employeeBrandFields(employee),
          },
        ],
        { ...normalizedArtifact, chatThreadId: state.chatThreadId ?? null },
      ),
    );
  }

  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId,
    agentName: `employee:${employee.employee_id}`,
    eventType: 'action',
    payload: {
      taskRunId,
      employeeName: employee.name,
      brandKey: employee.brand_key,
      outputLength: output.content.length,
      source: 'a2a',
    },
  });

  return {
    currentEmployeeId: employee.employee_id,
    currentTaskRunId: taskRunId ?? null,
    pendingAssignments: remaining,
    messages: [new AIMessage({ content: output.content })],
    currentStepOutputs: [
      ...state.currentStepOutputs,
      {
        employeeId: employee.employee_id,
        employeeName: employee.name,
        sourceKind: 'employee',
        roleSlug: employee.role_slug,
        content: output.content,
        taskRunId: taskRunId ?? '',
        stepIndex: preflight.stepIndex,
        ...employeeBrandFields(employee),
        artifact: normalizedArtifact
          ? {
              kind: 'file',
              fileName: normalizedArtifact.fileName,
              mimeType: normalizedArtifact.mimeType,
              content: output.content,
            }
          : undefined,
        deliverableEventEmitted: normalizedArtifact ? true : undefined,
      },
    ],
  };
}
