import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphError } from '../errors.js';
import {
  deliverableCreated,
  directChatCompleted,
  graphNodeEntered,
  llmStreamChunk,
  planCompleted,
  planStepCompleted,
} from '../events/event-factories.js';
import type { AicsGraphState, MeetingActionItem } from '../graph/state.js';
import { recordedLlmStream } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

const BOSS_SUMMARY_PROMPT = `You are the Boss AI summarizing your team's work for the user.

Given the employee results below, produce a clear, concise summary for the user.
Focus on what was accomplished and any key outcomes.

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

/**
 * Boss summary node — produces the final summary after employee work
 * or after an error handler. Marks the graph as completed.
 *
 * This is the ONLY node that uses streaming (chatStream via recordedLlmStream).
 * The tee pattern forwards chunks for UI real-time display while accumulating
 * the full content for graph state.
 */
export async function bossSummaryNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;

  // Announce node entry
  if (runtimeCtx) {
    runtimeCtx.eventBus.emit(
      graphNodeEntered(runtimeCtx.companyId, state.threadId, 'boss_summary'),
    );
  }

  // Emit planCompleted if there was a task plan
  if (runtimeCtx && state.taskPlan) {
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
  }

  // Emit directChatCompleted if this was a direct chat flow
  if (runtimeCtx && state.entryMode === 'direct_chat' && state.targetEmployeeId) {
    const empName = state.currentStepOutputs[0]?.employeeName ?? 'Unknown';
    runtimeCtx.eventBus.emit(
      directChatCompleted(runtimeCtx.companyId, state.targetEmployeeId, empName, state.threadId),
    );
  }

  // If there's already a direct reply from boss, just mark completed
  if (state.routeDecision === 'direct_reply') {
    return { completed: true };
  }

  // Collect employee results from messages
  const employeeResults = state.messages
    .filter((m) => m._getType() === 'ai')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter((c) => c.startsWith('['));

  if (employeeResults.length === 0) {
    if (runtimeCtx) {
      await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');
    }
    return {
      completed: true,
      messages: [new AIMessage({ content: 'Task processing complete.' })],
    };
  }

  // Helper: emit deliverable event when there are actual employee outputs
  const emitDeliverable = (finalContent: string) => {
    if (!runtimeCtx || state.currentStepOutputs.length === 0) return;
    const contributingEmployees = state.currentStepOutputs.map((o) => ({
      employeeId: o.employeeId,
      employeeName: o.employeeName,
    }));
    const title = state.taskPlan?.summary ?? finalContent.slice(0, 80);
    runtimeCtx.eventBus.emit(
      deliverableCreated(
        runtimeCtx.companyId,
        `del-${Date.now()}`,
        state.threadId,
        title,
        finalContent,
        contributingEmployees,
      ),
    );
  };

  // Append meeting action items suffix if present
  const actionItemsSuffix = formatMeetingActionItems(state.meetingActionItems ?? []);

  // Single employee result — no need for LLM summary
  if (employeeResults.length === 1) {
    const content = employeeResults[0]! + actionItemsSuffix;
    emitDeliverable(content);
    if (runtimeCtx) {
      await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');
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

  // recordedLlmStream: streams via teeStream, records llm_call, emits events
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
    (chunk) => {
      if (chunk.content) {
        runtimeCtx.eventBus.emit(
          llmStreamChunk(runtimeCtx.companyId, state.threadId, 'boss_summary', chunk.content),
        );
      }
    },
  );

  const finalContent = streamResult.fullContent + actionItemsSuffix;
  emitDeliverable(finalContent);
  await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');

  return {
    completed: true,
    messages: [new AIMessage({ content: finalContent })],
  };
}
