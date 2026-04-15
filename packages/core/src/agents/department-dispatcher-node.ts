import type { RunnableConfig } from '@langchain/core/runnables';
import { A2AClient } from '../a2a/a2a-client.js';
import {
  deliverableCreated,
  graphNodeEntered,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { inferDeliverableFile } from './infer-deliverable-file.js';

function decodeTextPayload(data: string): string {
  if (typeof atob === 'function') {
    return decodeURIComponent(
      Array.from(atob(data))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
    );
  }
  const maybeBuffer = (globalThis as { Buffer?: { from(data: string, encoding: string): { toString(enc: string): string } } }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(data, 'base64').toString('utf8');
  }
  return data;
}

function extractDepartmentOutput(task: Awaited<ReturnType<A2AClient['sendAndWait']>>): {
  content: string;
  fileName: string | null;
  mimeType: string | null;
} {
  const parts = task.artifacts?.flatMap((artifact) => artifact.parts) ?? [];
  for (const part of parts) {
    if (part.type === 'file' && part.data) {
      return {
        content: decodeTextPayload(part.data),
        fileName: part.name ?? null,
        mimeType: part.mimeType ?? null,
      };
    }
    if (part.type === 'text' && part.text.trim()) {
      return {
        content: part.text,
        fileName: null,
        mimeType: 'text/plain',
      };
    }
  }

  const messageText =
    task.status.message?.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n\n') ?? '';

  return {
    content: messageText || 'External department completed the task with no textual output.',
    fileName: null,
    mimeType: messageText ? 'text/plain' : null,
  };
}

function emitDepartmentSubtaskProgress(
  runtimeCtx: RuntimeContext,
  assignmentId: string,
  stepIndex: number,
  label: string,
  status: 'running' | 'done' | 'failed',
  assigneeName: string | undefined,
  threadId: string,
): void {
  runtimeCtx.eventBus.emit(
    taskSubtaskProgress(
      runtimeCtx.companyId,
      assignmentId,
      stepIndex,
      label,
      status,
      1,
      status === 'done' ? 1 : 0,
      threadId,
      {
        assigneeKind: 'department',
        assigneeName,
      },
    ),
  );
}

async function failDepartmentAssignment(
  runtimeCtx: RuntimeContext,
  assignmentId: string,
  taskRunId: string | undefined,
  assigneeName: string | undefined,
  stepIndex: number,
  label: string,
  threadId: string,
): Promise<void> {
  if (taskRunId) {
    await runtimeCtx.repos.taskRuns.updateStatus(taskRunId, 'failed');
    runtimeCtx.eventBus.emit(
      taskStateChanged(
        runtimeCtx.companyId,
        taskRunId,
        'queued',
        'failed',
        threadId,
        assignmentId,
        'department',
        assigneeName,
      ),
    );
  }
  emitDepartmentSubtaskProgress(
    runtimeCtx,
    assignmentId,
    stepIndex,
    label,
    'failed',
    assigneeName,
    threadId,
  );
}

export async function departmentDispatcherNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'department_dispatcher');
  runtimeCtx.eventBus.emit(
    graphNodeEntered(runtimeCtx.companyId, state.threadId, 'department_dispatcher'),
  );

  const remaining = [...state.pendingAssignments];
  const assignment = remaining.shift();
  if (!assignment) {
    return { pendingAssignments: [], currentStepOutputs: state.currentStepOutputs };
  }
  if (assignment.assigneeKind !== 'department') {
    return {
      pendingAssignments: [assignment, ...remaining],
      currentStepOutputs: state.currentStepOutputs,
    };
  }

  const department = (runtimeCtx.externalDepartments ?? []).find(
    (candidate) => candidate.id === assignment.employeeId,
  );
  const taskRunId = (assignment.inputJson.taskRunId as string | undefined) ?? undefined;
  const stepIndex = (assignment.inputJson.stepIndex as number | undefined) ?? 0;
  const label =
    (assignment.inputJson.description as string | undefined)?.slice(0, 60) ??
    assignment.assigneeName ??
    'External task';

  emitDepartmentSubtaskProgress(
    runtimeCtx,
    assignment.employeeId,
    stepIndex,
    label,
    'running',
    assignment.assigneeName,
    state.threadId,
  );

  if (!department?.peer) {
    await failDepartmentAssignment(
      runtimeCtx,
      assignment.employeeId,
      taskRunId,
      assignment.assigneeName,
      stepIndex,
      label,
      state.threadId,
    );
    return { pendingAssignments: remaining, currentStepOutputs: state.currentStepOutputs };
  }

  const client = new A2AClient(department.peer);

  try {
    const task = await client.sendAndWait(assignment.inputJson.description as string, {
      agentId: department.peer.agentId,
    });
    const output = extractDepartmentOutput(task);
    const inferredFile =
      output.fileName || output.mimeType
        ? {
            kind: 'file' as const,
            fileName: output.fileName ?? null,
            mimeType: output.mimeType ?? null,
          }
        : inferDeliverableFile(assignment.inputJson.description as string, output.content);
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
      runtimeCtx.eventBus.emit(
        taskStateChanged(
          runtimeCtx.companyId,
          taskRunId,
          'queued',
          'completed',
          state.threadId,
          assignment.employeeId,
          'department',
          department.name,
        ),
      );
    }

    emitDepartmentSubtaskProgress(
      runtimeCtx,
      assignment.employeeId,
      stepIndex,
      label,
      'done',
      department.name,
      state.threadId,
    );

    if (normalizedArtifact) {
      runtimeCtx.eventBus.emit(
        deliverableCreated(
          runtimeCtx.companyId,
          generateId('del'),
          state.threadId,
          normalizedArtifact.fileName ?? department.name,
          output.content,
          [
            {
              employeeId: department.id,
              employeeName: department.name,
              sourceKind: 'department',
              roleSlug: department.roleSlugHint,
            },
          ],
          normalizedArtifact,
        ),
      );
    }

    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `department:${department.id}`,
      eventType: 'action',
      payload: {
        departmentId: department.id,
        departmentName: department.name,
        taskRunId,
        outputLength: output.content.length,
      },
    });

    return {
      pendingAssignments: remaining,
      currentStepOutputs: [
        ...state.currentStepOutputs,
        {
          employeeId: department.id,
          employeeName: department.name,
          sourceKind: 'department',
          roleSlug: department.roleSlugHint,
          content: output.content,
          taskRunId: taskRunId ?? '',
          artifact: normalizedArtifact
            ? {
                kind: 'file',
                fileName: normalizedArtifact.fileName,
                mimeType: normalizedArtifact.mimeType,
                content: output.content,
              }
            : undefined,
        },
      ],
    };
  } catch {
    await failDepartmentAssignment(
      runtimeCtx,
      assignment.employeeId,
      taskRunId,
      department.name,
      stepIndex,
      label,
      state.threadId,
    );
    return { pendingAssignments: remaining, currentStepOutputs: state.currentStepOutputs };
  }
}
