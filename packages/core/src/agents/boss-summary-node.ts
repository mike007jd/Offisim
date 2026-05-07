import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphError } from '../errors.js';
import {
  deliverableCreated,
  directChatCompleted,
  graphNodeEntered,
  planCompleted,
  planStepCompleted,
} from '../events/event-factories.js';
import type { MeetingActionItem, OffisimGraphState } from '../graph/state.js';
import { forwardStreamChunks, recordedLlmStream } from '../llm/recorded-call.js';
import { EventConsolidator } from '../services/event-consolidator.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { getRunScope, getRuntime } from '../utils/get-runtime.js';
import { autoTitleThread } from './auto-title-thread.js';
import { inferDeliverableFile } from './infer-deliverable-file.js';

const BOSS_SUMMARY_PROMPT = `You are the Boss AI summarizing your team's work for the user.

Given the employee results below, produce a management-ready deliverable, not a raw transcript.
Use the structure that best fits the user's request. For project package / analysis / audit / file
organization work, use these sections in order:

1. Selected project or work target
2. Why this target was selected
3. Deliverables created
4. Key findings
5. Risks or missing information
6. File or folder organization result
7. Provider and team execution note

If the employee results do not prove that a required artifact was created, say the run is
incomplete and list the missing artifact. Never claim complete delivery just because planning or
discussion happened.

Employee results:
`;

/**
 * Format meeting action items into a human-readable text block.
 */
function formatMeetingActionItems(items: MeetingActionItem[]): string {
  if (items.length === 0) return '';
  const lines = items.map(
    (item) => `- [${item.priority}] ${item.assigneeName} — ${item.description}`,
  );
  return `\n\n**Action items (${items.length}):**\n${lines.join('\n')}`;
}

function stripLegacySpeakerPrefix(content: string): string {
  return content.replace(/^\[([^\]]*[a-zA-Z][^\]]*)\]:?\s?/, '');
}

function getLatestAiText(state: OffisimGraphState): string | null {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (!message || message._getType() !== 'ai' || typeof message.content !== 'string') {
      continue;
    }
    return message.content;
  }
  return null;
}

function emitDirectChatCompletedIfNeeded(
  state: OffisimGraphState,
  runtimeCtx: NonNullable<ReturnType<typeof getRuntime>>,
): void {
  if (state.entryMode !== 'direct_chat' || !state.targetEmployeeId) return;
  runtimeCtx.eventBus.emit(
    directChatCompleted(
      runtimeCtx.companyId,
      state.targetEmployeeId,
      state.currentStepOutputs[0]?.employeeName ?? 'Unknown',
      state.threadId,
    ),
  );
}

function planCompletionStats(state: OffisimGraphState): {
  total: number;
  completed: number;
  blocked: number;
  terminal: number;
  allTerminal: boolean;
} {
  const total = state.taskPlan?.steps.length ?? 0;
  const completed = new Set(state.completedStepIndices ?? []);
  const blocked = new Set(state.blockedStepIndices ?? []);
  const terminal = new Set([...completed, ...blocked]);
  return {
    total,
    completed: completed.size,
    blocked: blocked.size,
    terminal: terminal.size,
    allTerminal:
      total > 0 && state.taskPlan?.steps.every((step) => terminal.has(step.stepIndex)) === true,
  };
}

function isPlanFullyCompleted(state: OffisimGraphState): boolean {
  const stats = planCompletionStats(state);
  return stats.total > 0 && stats.allTerminal && stats.blocked === 0;
}

function blockedPlanSummaryText(stats: ReturnType<typeof planCompletionStats>): string {
  const pending = Math.max(0, stats.total - stats.terminal);
  const pendingText =
    pending > 0
      ? ` ${pending} remaining step(s) cannot proceed until human review clears the blocked task.`
      : ' Human review is required before this can be treated as complete.';
  return `Plan is blocked after ${stats.blocked} blocked step(s).${pendingText} This is not complete.`;
}

function pendingPlanSummaryText(stats: ReturnType<typeof planCompletionStats>): string {
  return `Cannot summarize yet: ${stats.terminal}/${stats.total} plan step(s) are terminal. ${Math.max(
    0,
    stats.total - stats.terminal,
  )} step(s) still need execution or review before this can be treated as complete.`;
}

function getSummaryStepOutputs(state: OffisimGraphState): OffisimGraphState['currentStepOutputs'] {
  if (state.currentStepOutputs.length > 0) {
    return state.currentStepOutputs;
  }
  return state.stepResults.flatMap((result) => result.outputs);
}

function stepOutputContentForSummary(
  output: OffisimGraphState['currentStepOutputs'][number],
): string {
  if (output.content.trim().length > 0) {
    return output.content;
  }
  return output.artifact?.content ?? '';
}

function emptySingleEmployeeSummaryText(
  output: OffisimGraphState['currentStepOutputs'][number] | undefined,
): string {
  const employeeName = output?.employeeName?.trim() || 'Employee';
  return `${employeeName} completed the assigned work but did not return text output.`;
}

/**
 * Boss summary node — produces the final summary after employee work
 * or after an error handler. Marks the graph as completed.
 *
 * This is the primary summary node that uses streaming (chatStream via recordedLlmStream).
 * The tee pattern forwards chunks for UI real-time display while accumulating
 * the full content for graph state.
 */
export async function bossSummaryNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'boss_summary', { optional: true });
  const isDirectChatSummary = state.entryMode === 'direct_chat' && !!state.targetEmployeeId;

  if (runtimeCtx && !isDirectChatSummary) {
    runtimeCtx.eventBus.emit(
      graphNodeEntered(runtimeCtx.companyId, state.threadId, 'boss_summary', getRunScope(config)),
    );
  }

  const latestAiText = getLatestAiText(state);
  // error_handler already marked the thread failed and produced the user-facing
  // retryable message for this run. Do not overwrite that failure with a bogus
  // "Task processing complete." completion record.
  if (latestAiText?.startsWith('[Error Handler]')) {
    return { completed: true };
  }

  // Emit planCompleted only when every step genuinely completed. Blocked plans
  // need human attention and must not publish a completion signal.
  if (runtimeCtx && state.taskPlan && isPlanFullyCompleted(state)) {
    // If there are pending step outputs (the last step didn't go through stepAdvance),
    // emit planStepCompleted for the final step first.
    if (state.currentStepOutputs.length > 0) {
      runtimeCtx.eventBus.emit(
        planStepCompleted(
          runtimeCtx.companyId,
          state.taskPlan.planId,
          state.currentStepIndex,
          state.currentStepOutputs.length,
          state.threadId,
        ),
      );
    }

    runtimeCtx.eventBus.emit(
      planCompleted(
        runtimeCtx.companyId,
        state.taskPlan.planId,
        state.taskPlan.steps.length,
        state.threadId,
      ),
    );

    // Consolidate execution events into experience memory (non-blocking, best-effort)
    if (runtimeCtx.repos.agentEvents) {
      const consolidator = new EventConsolidator(
        runtimeCtx.repos.agentEvents,
        runtimeCtx.repos.memories,
        runtimeCtx.llmGateway,
        runtimeCtx.eventBus,
        runtimeCtx.systemCaller,
      );
      consolidator
        .consolidate({
          threadId: state.threadId,
          companyId: runtimeCtx.companyId,
          projectName: state.taskPlan.summary,
        })
        .catch(() => {}); // fire-and-forget — must not block summary
    }
  }

  // If there's already a direct reply from boss, just mark completed
  if (state.routeDecision === 'direct_reply') {
    if (runtimeCtx) autoTitleThread(runtimeCtx, state);
    return { completed: true };
  }

  // Collect employee results. Prefer currentStepOutputs (authoritative) over
  // message content filtering (which can misidentify error/meeting messages).
  // Fall back to message filtering for meeting flow which doesn't populate stepOutputs.
  const EXCLUDED_PREFIXES = ['[Error Handler]', '[Meeting]'];
  const summaryStepOutputs = getSummaryStepOutputs(state);
  const employeeResults =
    summaryStepOutputs.length > 0
      ? summaryStepOutputs.map((o) => `[${o.employeeName}]: ${stepOutputContentForSummary(o)}`)
      : state.messages
          .filter((m) => m._getType() === 'ai')
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .filter(
            (c) => c.startsWith('[') && !EXCLUDED_PREFIXES.some((prefix) => c.startsWith(prefix)),
          );
  const employeeFinalOutputs =
    summaryStepOutputs.length > 0
      ? summaryStepOutputs.map(stepOutputContentForSummary)
      : employeeResults.map(stripLegacySpeakerPrefix);

  const stats = planCompletionStats(state);
  if (state.taskPlan && stats.blocked > 0) {
    const content = blockedPlanSummaryText(stats);
    if (runtimeCtx) {
      const thread = await runtimeCtx.repos.threads.findById(state.threadId);
      if (thread?.status !== 'cancelled') {
        await runtimeCtx.repos.threads.updateStatus(state.threadId, 'running');
      }
      await appendAgentEvent(runtimeCtx, {
        projectId: state.projectId,
        threadId: state.threadId,
        agentName: 'boss',
        eventType: 'action',
        payload: {
          action: 'summary',
          blockedSteps: stats.blocked,
          pendingSteps: Math.max(0, stats.total - stats.terminal),
          completedSteps: stats.completed,
        },
      });
      autoTitleThread(runtimeCtx, state);
    }
    return {
      completed: false,
      interruptReason: 'boss-summary-blocked-plan',
      messages: [new AIMessage({ content })],
    };
  }

  if (state.taskPlan && stats.total > 0 && !stats.allTerminal && employeeResults.length > 0) {
    const content = pendingPlanSummaryText(stats);
    if (runtimeCtx) {
      const thread = await runtimeCtx.repos.threads.findById(state.threadId);
      if (thread?.status !== 'cancelled') {
        await runtimeCtx.repos.threads.updateStatus(state.threadId, 'running');
      }
      await appendAgentEvent(runtimeCtx, {
        projectId: state.projectId,
        threadId: state.threadId,
        agentName: 'boss',
        eventType: 'action',
        payload: {
          action: 'summary',
          pendingSteps: Math.max(0, stats.total - stats.terminal),
          completedSteps: stats.completed,
          blockedSteps: stats.blocked,
        },
      });
      autoTitleThread(runtimeCtx, state);
    }
    return {
      completed: false,
      interruptReason: 'boss-summary-pending-plan',
      messages: [new AIMessage({ content })],
    };
  }

  if (employeeResults.length === 0) {
    const hasNoPlanState =
      !state.taskPlan &&
      state.pendingAssignments.length === 0 &&
      (state.completedStepIndices ?? []).length === 0 &&
      (state.blockedStepIndices ?? []).length === 0;

    if (hasNoPlanState) {
      return {
        completed: false,
        messages: [new AIMessage({ content: 'No executable work was completed in this turn.' })],
      };
    }

    if (state.taskPlan && stats.allTerminal) {
      const content =
        stats.blocked > 0
          ? `Plan reached a terminal state with ${stats.completed} completed step(s) and ${stats.blocked} blocked step(s). Human review is required before this can be treated as complete.`
          : `Plan completed ${stats.completed}/${stats.total} step(s), but no employee output was captured for summary.`;
      if (runtimeCtx && stats.blocked === 0) {
        const thread = await runtimeCtx.repos.threads.findById(state.threadId);
        if (thread?.status !== 'cancelled') {
          await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');
        }
      }
      return {
        completed: stats.blocked === 0,
        messages: [new AIMessage({ content })],
      };
    }

    if (runtimeCtx) {
      const thread = await runtimeCtx.repos.threads.findById(state.threadId);
      if (thread?.status === 'queued') {
        await runtimeCtx.repos.threads.updateStatus(state.threadId, 'running');
      }
    }
    return {
      completed: false,
      interruptReason: 'boss-summary-empty-with-pending-plan',
      messages: [
        new AIMessage({
          content: `Cannot summarize yet: ${stats.terminal}/${stats.total} plan step(s) are terminal and ${state.pendingAssignments.length} assignment(s) remain queued.`,
        }),
      ],
    };
  }

  // Helper: emit deliverable event when there are actual employee outputs
  const emitDeliverable = (finalContent: string) => {
    if (!runtimeCtx || summaryStepOutputs.length === 0) return;
    const contributingEmployees = summaryStepOutputs.map((o) => ({
      employeeId: o.employeeId,
      employeeName: o.employeeName,
      sourceKind: o.sourceKind,
      roleSlug: o.roleSlug,
      isExternal: o.isExternal,
      brandKey: o.brandKey,
    }));
    const title = state.taskPlan?.summary ?? stripLegacySpeakerPrefix(finalContent).slice(0, 80);
    const inferredFile = inferDeliverableFile(title, finalContent);
    runtimeCtx.eventBus.emit(
      deliverableCreated(
        runtimeCtx.companyId,
        generateId('del'),
        state.threadId,
        title,
        finalContent,
        contributingEmployees,
        { ...(inferredFile ?? {}), chatThreadId: state.chatThreadId ?? null },
      ),
    );
  };

  // Append meeting action items suffix if present
  const actionItemsSuffix = formatMeetingActionItems(state.meetingActionItems ?? []);

  // Single employee result — no need for LLM summary
  if (employeeResults.length === 1) {
    const firstEmployeeResult =
      employeeFinalOutputs[0]?.trim() || emptySingleEmployeeSummaryText(summaryStepOutputs[0]);
    const content = firstEmployeeResult + actionItemsSuffix;
    const existingArtifact = summaryStepOutputs[0]?.artifact;
    const inferredFile = inferDeliverableFile(state.taskPlan?.summary ?? '', content);
    if (!existingArtifact && !inferredFile) {
      emitDeliverable(content);
    }
    if (runtimeCtx) {
      await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');
    }
    if (runtimeCtx) emitDirectChatCompletedIfNeeded(state, runtimeCtx);
    if (runtimeCtx) {
      await appendAgentEvent(runtimeCtx, {
        projectId: state.projectId,
        threadId: state.threadId,
        agentName: 'boss',
        eventType: 'action',
        payload: { action: 'summary', employeeResultCount: 1, outputLength: content.length },
      });
      autoTitleThread(runtimeCtx, state);
    }
    return {
      completed: true,
      messages: [new AIMessage({ content })],
    };
  }

  // Multiple employee results — use streaming LLM to produce summary
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'boss_summary');
  }

  const resolved = runtimeCtx.modelResolver.resolve(null, 'boss');
  const resultsText = employeeResults.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const streamResult = await recordedLlmStream(
    runtimeCtx,
    {
      messages: [
        { role: 'system', content: BOSS_SUMMARY_PROMPT + resultsText },
        { role: 'user', content: 'Summarize the team results above.' },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    },
    { nodeName: 'boss_summary', provider: resolved.provider, model: resolved.model },
    forwardStreamChunks(runtimeCtx, state.threadId, 'boss_summary', {
      runScope: getRunScope(config),
    }),
  );

  const finalContent = streamResult.fullContent + actionItemsSuffix;
  emitDeliverable(finalContent);
  await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');
  emitDirectChatCompletedIfNeeded(state, runtimeCtx);

  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: 'boss',
    eventType: 'action',
    payload: {
      action: 'summary',
      employeeResultCount: employeeResults.length,
      outputLength: finalContent.length,
    },
  });
  autoTitleThread(runtimeCtx, state);

  return {
    completed: true,
    messages: [new AIMessage({ content: finalContent })],
  };
}
