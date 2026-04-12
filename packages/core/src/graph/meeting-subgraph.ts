import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { buildEmployeePrompt } from '../agents/employee-builder.js';
import { GraphError } from '../errors.js';
import {
  meetingActionCreated,
  meetingStateChanged,
  notificationCreated,
} from '../events/event-factories.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { Logger } from '../services/logger.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import type { MeetingActionItem, OffisimGraphState } from './state.js';

const logger = new Logger('meeting');

const MAX_TURNS = 10;

/** Internal task type used to store meeting turn state in pendingAssignments. */
const MEETING_STATE_TASK_TYPE = '__meeting_state';

interface MeetingTurnState {
  turnCount: number;
  participantIndex: number;
  participantIds: string[];
  transcript: string[];
}

function parseMeetingTurnState(state: OffisimGraphState): MeetingTurnState {
  // Extract turn state from the last message metadata or defaults
  const existing = state.pendingAssignments.find((a) => a.taskType === MEETING_STATE_TASK_TYPE);
  if (existing) {
    return existing.inputJson as unknown as MeetingTurnState;
  }
  return { turnCount: 0, participantIndex: 0, participantIds: [], transcript: [] };
}

/**
 * Meeting start — creates meeting_sessions record and gathers participants.
 */
export async function meetingStartNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'meeting_start');

  const { repos, eventBus, companyId, threadId } = runtimeCtx;

  // Get all enabled employees for the meeting
  const employees = await repos.employees.findByCompany(companyId);
  const participants = employees.filter((e) => e.enabled);
  if (participants.length === 1 && participants[0]) {
    eventBus.emit(
      notificationCreated(
        companyId,
        `meeting-solo-warn-${Date.now()}`,
        'warning',
        'Solo meeting',
        `Only ${participants[0].name} is available — consider hiring more team members for productive meetings.`,
        'runtime',
        { employeeId: participants[0].employee_id },
      ),
    );
  }

  if (participants.length === 0) {
    throw new GraphError('No participants available for meeting', 'meeting_start');
  }

  // Derive topic from user message
  const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === 'human');
  const topic =
    typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : 'General discussion';

  const meetingId = generateId('mtg');

  await repos.meetings.create({
    meeting_id: meetingId,
    company_id: companyId,
    thread_id: threadId,
    topic,
    status: 'running',
    summary_json: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const participantIds = participants.map((p) => p.employee_id);
  eventBus.emit(
    meetingStateChanged(companyId, meetingId, 'scheduled', 'running', participantIds, threadId),
  );

  // Store meeting turn state in pendingAssignments
  const turnState: MeetingTurnState = {
    turnCount: 0,
    participantIndex: 0,
    participantIds,
    transcript: [],
  };
  const firstParticipantId = participantIds[0];
  if (!firstParticipantId) {
    throw new GraphError('Meeting participants resolved to an empty list', 'meeting_start');
  }

  return {
    meetingId,
    pendingAssignments: [
      {
        taskType: MEETING_STATE_TASK_TYPE,
        employeeId: firstParticipantId,
        inputJson: turnState as unknown as Record<string, unknown>,
      },
    ],
    messages: [
      new AIMessage({
        content: `[Meeting] Started: "${topic}" with ${participants.length} participants.`,
      }),
    ],
  };
}

/**
 * Participant turn — each participant speaks in sequence.
 */
export async function participantTurnNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'participant_turn');

  const { modelResolver, repos, companyId } = runtimeCtx;
  const turnState = parseMeetingTurnState(state);

  const currentParticipantId = turnState.participantIds[turnState.participantIndex];
  if (!currentParticipantId) {
    return { pendingAssignments: [] };
  }

  const employee = await repos.employees.findById(currentParticipantId);
  if (!employee) {
    // Participant was deleted mid-meeting — skip to next participant gracefully
    logger.warn(`Meeting participant ${currentParticipantId} not found — skipping turn`);
    if (turnState.participantIds.length === 0) {
      return { pendingAssignments: [] };
    }
    const nextIndex = (turnState.participantIndex + 1) % turnState.participantIds.length;
    const nextTurn: MeetingTurnState = { ...turnState, participantIndex: nextIndex };
    return {
      pendingAssignments: [
        {
          taskType: MEETING_STATE_TASK_TYPE,
          employeeId: currentParticipantId,
          inputJson: nextTurn as unknown as Record<string, unknown>,
        },
      ],
    };
  }

  const company = await repos.companies.findById(companyId);
  if (!company) {
    throw new GraphError(`Company ${companyId} not found`, 'participant_turn');
  }

  const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === 'human');
  const topic =
    typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : 'General discussion';

  const resolved = modelResolver.resolve(null, employee.role_slug);
  const context =
    turnState.transcript.length > 0
      ? `Previous discussion:\n${turnState.transcript.join('\n')}\n\n`
      : '';

  const prompt = buildEmployeePrompt(
    employee,
    company,
    `${context}Meeting topic: ${topic}\n\nShare your perspective concisely.`,
  );

  const llmResponse = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `It's your turn to speak in the meeting about: ${topic}` },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    },
    { nodeName: 'meeting_participant', provider: resolved.provider, model: resolved.model },
  );

  // Advance turn state
  const nextIndex = turnState.participantIndex + 1;
  const nextTurnCount =
    nextIndex >= turnState.participantIds.length ? turnState.turnCount + 1 : turnState.turnCount;
  const nextParticipantIndex = nextIndex >= turnState.participantIds.length ? 0 : nextIndex;

  const updatedTranscript = [...turnState.transcript, `[${employee.name}]: ${llmResponse.content}`];

  const updatedTurnState: MeetingTurnState = {
    turnCount: nextTurnCount,
    participantIndex: nextParticipantIndex,
    participantIds: turnState.participantIds,
    transcript: updatedTranscript,
  };

  const nextParticipantId =
    turnState.participantIds[nextParticipantIndex] ??
    turnState.participantIds[0] ??
    state.currentEmployeeId;
  if (!nextParticipantId) {
    throw new Error('Expected at least one meeting participant');
  }

  // Check if boss sent a meeting interrupt while the LLM call was running
  const interruptBox = runtimeCtx.meetingInterruptBox;
  const pendingInterrupt = interruptBox.pending;
  if (pendingInterrupt) {
    // Consume the interrupt so it's not processed again
    interruptBox.pending = null;
  }

  return {
    meetingInterrupt: pendingInterrupt ?? null,
    pendingAssignments: [
      {
        taskType: MEETING_STATE_TASK_TYPE,
        employeeId: nextParticipantId,
        inputJson: updatedTurnState as unknown as Record<string, unknown>,
      },
    ],
    messages: [new AIMessage({ content: `[${employee.name}]: ${llmResponse.content}` })],
  };
}

/**
 * Turn check — decides if meeting should continue or end.
 * Now checks for boss interrupts before proceeding to next turn.
 */
export function meetingTurnCheck(state: OffisimGraphState): string {
  // Check for boss interrupt first
  if (state.meetingInterrupt) {
    switch (state.meetingInterrupt.type) {
      case 'pause':
        return 'meeting_paused';
      case 'end':
        return 'meeting_end';
      case 'inject':
        return 'meeting_inject';
      default:
        break;
    }
  }

  const turnState = parseMeetingTurnState(state);

  // End if max turns reached or if all participants have spoken at least once
  // and we've completed a full round
  if (turnState.turnCount >= MAX_TURNS) {
    return 'meeting_end';
  }

  // Minimum: each participant speaks once (one full round)
  if (turnState.turnCount >= 1 && turnState.participantIndex === 0) {
    return 'meeting_end';
  }

  return 'participant_turn';
}

/**
 * Meeting paused — persists state and waits for boss to resume or end.
 * The graph uses LangGraph's checkpoint to persist the paused state.
 * The boss can later send a resume or end command via OrchestrationService.
 */
export async function meetingPausedNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'meeting_paused');

  const { repos, eventBus, companyId, threadId } = runtimeCtx;
  const turnState = parseMeetingTurnState(state);

  if (state.meetingId) {
    await repos.meetings.updateStatus(state.meetingId, 'paused');
    eventBus.emit(
      meetingStateChanged(
        companyId,
        state.meetingId,
        'running',
        'paused',
        turnState.participantIds,
        threadId,
      ),
    );
  }

  logger.info('Meeting paused by boss', { meetingId: state.meetingId });

  return {
    meetingInterrupt: null, // Clear the interrupt after handling
    messages: [
      new AIMessage({
        content: `[Meeting] Paused by boss after ${turnState.transcript.length} contributions. Waiting for resume or end command.`,
      }),
    ],
  };
}

/**
 * Resume check — called after meeting_paused when the boss sends a command.
 * Routes to participant_turn (resume) or meeting_end (end).
 */
export function meetingResumeCheck(state: OffisimGraphState): string {
  if (state.meetingInterrupt?.type === 'end') {
    return 'meeting_end';
  }
  // Default: resume the meeting
  return 'meeting_resume';
}

/**
 * Meeting resume — restores meeting to running state and continues turns.
 */
export async function meetingResumeNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'meeting_resume');

  const { repos, eventBus, companyId, threadId } = runtimeCtx;
  const turnState = parseMeetingTurnState(state);

  if (state.meetingId) {
    await repos.meetings.updateStatus(state.meetingId, 'running');
    eventBus.emit(
      meetingStateChanged(
        companyId,
        state.meetingId,
        'paused',
        'running',
        turnState.participantIds,
        threadId,
      ),
    );
  }

  logger.info('Meeting resumed by boss', { meetingId: state.meetingId });

  return {
    meetingInterrupt: null, // Clear the interrupt
    messages: [
      new AIMessage({
        content: '[Meeting] Resumed by boss. Continuing discussion.',
      }),
    ],
  };
}

/**
 * Meeting inject — boss comment gets injected into the meeting transcript as a turn.
 */
export async function meetingInjectNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  // Validate runtime exists (throws if missing) even though this node doesn't use it directly
  getRuntime(config, 'meeting_inject');

  const bossComment = state.meetingInterrupt?.bossComment ?? '(No comment provided)';
  const turnState = parseMeetingTurnState(state);

  // Inject boss comment into the transcript
  const updatedTranscript = [...turnState.transcript, `[Boss]: ${bossComment}`];

  const updatedTurnState: MeetingTurnState = {
    ...turnState,
    transcript: updatedTranscript,
  };

  const nextParticipantId =
    turnState.participantIds[turnState.participantIndex] ??
    turnState.participantIds[0] ??
    state.currentEmployeeId;
  if (!nextParticipantId) {
    throw new Error('Expected at least one meeting participant');
  }

  logger.info('Boss injected comment into meeting', {
    meetingId: state.meetingId,
    comment: bossComment,
  });

  return {
    meetingInterrupt: null, // Clear the interrupt after handling
    pendingAssignments: [
      {
        taskType: MEETING_STATE_TASK_TYPE,
        employeeId: nextParticipantId,
        inputJson: updatedTurnState as unknown as Record<string, unknown>,
      },
    ],
    messages: [
      new AIMessage({
        content: `[Boss]: ${bossComment}`,
      }),
    ],
  };
}

/**
 * Build a Zod schema for meeting output, with assigneeId dynamically constrained
 * to the set of known employee IDs.
 */
function buildMeetingOutputSchema(employeeIds: [string, ...string[]]) {
  return z.object({
    summary: z.string(),
    actionItems: z.array(
      z.object({
        description: z.string(),
        assigneeId: z.enum(employeeIds),
        priority: z.enum(['high', 'medium', 'low']),
        dependsOnIndex: z.array(z.number()).default([]),
      }),
    ),
    decisions: z.array(z.string()),
  });
}

/**
 * Extract structured action items from the meeting transcript using LLM.
 * Returns empty array on any parse/validation failure (graceful fallback).
 */
async function extractMeetingActionItems(
  runtimeCtx: RuntimeContext,
  transcript: string[],
  employees: EmployeeRow[],
): Promise<MeetingActionItem[]> {
  const employeeIds = employees.map((e) => e.employee_id);
  if (employeeIds.length === 0) return [];

  const employeeListText = employees
    .map((e) => `- ID: ${e.employee_id}, Name: ${e.name}, Role: ${e.role_slug}`)
    .join('\n');

  const systemPrompt = `You are analyzing a meeting transcript to extract structured output.

Available employees:
${employeeListText}

Respond ONLY with valid JSON matching this schema:
{
  "summary": "brief meeting summary",
  "actionItems": [
    {
      "description": "what needs to be done",
      "assigneeId": "one of the employee IDs listed above",
      "priority": "high" | "medium" | "low",
      "dependsOnIndex": [indexes of other action items this depends on]
    }
  ],
  "decisions": ["key decisions made"]
}

Do not include any text outside the JSON object.`;

  const transcriptText = transcript.join('\n');

  try {
    const resolved = runtimeCtx.modelResolver.resolve(null, 'boss');
    const response = await recordedLlmCall(
      runtimeCtx,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Meeting transcript:\n${transcriptText}\n\nExtract the structured output.`,
          },
        ],
        model: resolved.model,
        temperature: 0.2,
        maxTokens: resolved.maxTokens,
      },
      { nodeName: 'meeting_end', provider: resolved.provider, model: resolved.model },
    );

    // Parse JSON from response (handles markdown code blocks and embedded JSON)
    const parsed = extractJsonFromLlm(response.content);
    if (!parsed) {
      logger.warn('Failed to extract JSON from LLM response, falling back to empty action items');
      return [];
    }

    // Validate with Zod
    const zodSchema = buildMeetingOutputSchema(employeeIds as [string, ...string[]]);
    const result = zodSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn('Zod validation failed, falling back to empty action items', {
        zodError: result.error.message,
      });
      return [];
    }

    // Build employee name lookup
    const employeeNameMap = new Map(employees.map((e) => [e.employee_id, e.name]));

    // Create TaskRuns and build MeetingActionItem array
    const actionItems: MeetingActionItem[] = [];
    const taskRunIds: string[] = [];

    for (const item of result.data.actionItems) {
      const taskRunId = generateId('tr');
      taskRunIds.push(taskRunId);

      await runtimeCtx.repos.taskRuns.create({
        task_run_id: taskRunId,
        thread_id: runtimeCtx.threadId,
        employee_id: item.assigneeId,
        parent_task_run_id: null,
        task_type: 'meeting_action',
        status: 'queued',
        input_json: JSON.stringify({ description: item.description, priority: item.priority }),
        output_json: null,
        started_at: new Date().toISOString(),
      });

      // Map dependsOnIndex to taskRunIds.
      // Current item's ID is already pushed at taskRunIds[length-1],
      // so `idx < length-1` excludes self-reference while allowing all prior items.
      const dependsOn = item.dependsOnIndex
        .filter((idx) => idx >= 0 && idx < taskRunIds.length - 1)
        .map((idx) => taskRunIds[idx] ?? '')
        .filter((id) => id !== '');

      const actionItem: MeetingActionItem = {
        taskRunId,
        description: item.description,
        assigneeEmployeeId: item.assigneeId,
        assigneeName: employeeNameMap.get(item.assigneeId) ?? 'Unknown',
        priority: item.priority,
        dependsOn,
      };

      actionItems.push(actionItem);
    }

    return actionItems;
  } catch (error) {
    logger.warn('Action item extraction failed, falling back to empty', { error: String(error) });
    return [];
  }
}

/**
 * Meeting end — produce summary, extract action items, and update meeting record.
 */
export async function meetingEndNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'meeting_end');

  const { repos, eventBus, companyId, threadId } = runtimeCtx;
  const turnState = parseMeetingTurnState(state);

  // 1. Get employees for action-item extraction
  const employees = await repos.employees.findByCompany(companyId);

  // 2. Extract structured action items from transcript
  const meetingActionItems = await extractMeetingActionItems(
    runtimeCtx,
    turnState.transcript,
    employees,
  );

  // 3. Emit meeting.action.created events
  if (state.meetingId) {
    for (const item of meetingActionItems) {
      eventBus.emit(
        meetingActionCreated(
          companyId,
          state.meetingId,
          item.taskRunId,
          item.description,
          item.assigneeEmployeeId,
          item.priority,
          item.dependsOn,
        ),
      );
    }
  }

  // 4. Update meeting record
  const summaryJson = JSON.stringify({
    totalTurns: turnState.turnCount,
    participants: turnState.participantIds,
    transcript: turnState.transcript,
  });

  if (state.meetingId) {
    await repos.meetings.updateStatus(state.meetingId, 'completed', summaryJson);
    eventBus.emit(
      meetingStateChanged(
        companyId,
        state.meetingId,
        'running',
        'completed',
        turnState.participantIds,
        threadId,
      ),
    );
  }

  return {
    pendingAssignments: [],
    completed: true,
    meetingActionItems,
    messages: [
      new AIMessage({
        content: `[Meeting] Concluded after ${turnState.transcript.length} contributions from ${turnState.participantIds.length} participants.`,
      }),
    ],
  };
}
