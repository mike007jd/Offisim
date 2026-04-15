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
import type { MeetingActionItem, OffisimGraphState } from '../graph/state.js';
import { recordedLlmStream } from '../llm/recorded-call.js';
import { EventConsolidator } from '../services/event-consolidator.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { inferDeliverableFile } from './infer-deliverable-file.js';

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

function stripLegacySpeakerPrefix(content: string): string {
  return content.replace(/^\[([^\]]*[a-zA-Z][^\]]*)\]:?\s?/, '');
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

  // Collect employee results. Prefer currentStepOutputs (authoritative) over
  // message content filtering (which can misidentify error/meeting messages).
  // Fall back to message filtering for meeting flow which doesn't populate stepOutputs.
  const EXCLUDED_PREFIXES = ['[Error Handler]', '[Meeting]'];
  const employeeResults =
    state.currentStepOutputs.length > 0
      ? state.currentStepOutputs.map((o) => `[${o.employeeName}]: ${o.content}`)
      : state.messages
          .filter((m) => m._getType() === 'ai')
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .filter(
            (c) => c.startsWith('[') && !EXCLUDED_PREFIXES.some((prefix) => c.startsWith(prefix)),
          );
  const employeeFinalOutputs =
    state.currentStepOutputs.length > 0
      ? state.currentStepOutputs.map((o) => o.content)
      : employeeResults.map(stripLegacySpeakerPrefix);

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
      roleSlug: o.roleSlug,
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
        inferredFile ?? undefined,
      ),
    );
  };

  // Append meeting action items suffix if present
  const actionItemsSuffix = formatMeetingActionItems(state.meetingActionItems ?? []);

  // Single employee result — no need for LLM summary
  if (employeeResults.length === 1) {
    const firstEmployeeResult = employeeFinalOutputs[0];
    if (!firstEmployeeResult) {
      throw new Error('Expected a single employee result for boss summary fast path');
    }
    const content = firstEmployeeResult + actionItemsSuffix;
    const existingArtifact = state.currentStepOutputs[0]?.artifact;
    const inferredFile = inferDeliverableFile(state.taskPlan?.summary ?? '', content);
    if (!existingArtifact && !inferredFile) {
      emitDeliverable(content);
    }
    if (runtimeCtx) {
      await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');
    }
    if (runtimeCtx) {
      await appendAgentEvent(runtimeCtx, {
        projectId: state.projectId,
        threadId: state.threadId,
        agentName: 'boss',
        eventType: 'action',
        payload: { action: 'summary', employeeResultCount: 1, outputLength: content.length },
      });
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
      if (chunk.reasoning) {
        runtimeCtx.eventBus.emit(
          llmStreamChunk(
            runtimeCtx.companyId,
            state.threadId,
            'boss_summary',
            chunk.reasoning,
            'reasoning',
          ),
        );
      }
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

  return {
    completed: true,
    messages: [new AIMessage({ content: finalContent })],
  };
}
