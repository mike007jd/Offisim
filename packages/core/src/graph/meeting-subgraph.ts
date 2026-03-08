import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AicsGraphState } from './state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { GraphError } from '../errors.js';
import { meetingStateChanged } from '../events/event-factories.js';
import { buildEmployeePrompt } from '../agents/employee-builder.js';
import { recordedLlmCall } from '../llm/recorded-call.js';

const MAX_TURNS = 10;

interface MeetingTurnState {
  turnCount: number;
  participantIndex: number;
  participantIds: string[];
  transcript: string[];
}

function parseMeetingTurnState(state: AicsGraphState): MeetingTurnState {
  // Extract turn state from the last message metadata or defaults
  const existing = state.pendingAssignments.find((a) => a.taskType === '__meeting_state');
  if (existing) {
    return existing.inputJson as unknown as MeetingTurnState;
  }
  return { turnCount: 0, participantIndex: 0, participantIds: [], transcript: [] };
}

/**
 * Meeting start — creates meeting_sessions record and gathers participants.
 */
export async function meetingStartNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'meeting_start');
  }

  const { repos, eventBus, companyId, threadId } = runtimeCtx;

  // Get all enabled employees for the meeting
  const employees = await repos.employees.findByCompany(companyId);
  const participants = employees.filter((e) => e.enabled);

  if (participants.length === 0) {
    throw new GraphError('No participants available for meeting', 'meeting_start');
  }

  // Derive topic from user message
  const lastUserMessage = [...state.messages]
    .reverse()
    .find((m) => m._getType() === 'human');
  const topic = typeof lastUserMessage?.content === 'string'
    ? lastUserMessage.content
    : 'General discussion';

  const meetingId = `mtg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await repos.meetings.create({
    meeting_id: meetingId,
    company_id: companyId,
    thread_id: threadId,
    topic,
    status: 'active',
    summary_json: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const participantIds = participants.map((p) => p.employee_id);
  eventBus.emit(meetingStateChanged(companyId, meetingId, 'scheduled', 'active', participantIds, threadId));

  // Store meeting turn state in pendingAssignments
  const turnState: MeetingTurnState = {
    turnCount: 0,
    participantIndex: 0,
    participantIds,
    transcript: [],
  };

  return {
    meetingId,
    pendingAssignments: [{
      taskType: '__meeting_state',
      employeeId: participantIds[0]!,
      inputJson: turnState as unknown as Record<string, unknown>,
    }],
    messages: [new AIMessage({ content: `[Meeting] Started: "${topic}" with ${participants.length} participants.` })],
  };
}

/**
 * Participant turn — each participant speaks in sequence.
 */
export async function participantTurnNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'participant_turn');
  }

  const { modelResolver, repos, companyId } = runtimeCtx;
  const turnState = parseMeetingTurnState(state);

  const currentParticipantId = turnState.participantIds[turnState.participantIndex];
  if (!currentParticipantId) {
    return { pendingAssignments: [] };
  }

  const employee = await repos.employees.findById(currentParticipantId);
  if (!employee) {
    throw new GraphError(`Meeting participant ${currentParticipantId} not found`, 'participant_turn');
  }

  const company = await repos.companies.findById(companyId);
  if (!company) {
    throw new GraphError(`Company ${companyId} not found`, 'participant_turn');
  }

  const lastUserMessage = [...state.messages]
    .reverse()
    .find((m) => m._getType() === 'human');
  const topic = typeof lastUserMessage?.content === 'string'
    ? lastUserMessage.content
    : 'General discussion';

  const resolved = modelResolver.resolve(null, employee.role_slug);
  const context = turnState.transcript.length > 0
    ? `Previous discussion:\n${turnState.transcript.join('\n')}\n\n`
    : '';

  const prompt = buildEmployeePrompt(employee, company, `${context}Meeting topic: ${topic}\n\nShare your perspective concisely.`);

  const llmResponse = await recordedLlmCall(runtimeCtx, {
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `It's your turn to speak in the meeting about: ${topic}` },
    ],
    model: resolved.model,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  }, { nodeName: 'meeting_participant', provider: resolved.provider, model: resolved.model });

  // Advance turn state
  const nextIndex = turnState.participantIndex + 1;
  const nextTurnCount = nextIndex >= turnState.participantIds.length
    ? turnState.turnCount + 1
    : turnState.turnCount;
  const nextParticipantIndex = nextIndex >= turnState.participantIds.length
    ? 0
    : nextIndex;

  const updatedTranscript = [...turnState.transcript, `[${employee.name}]: ${llmResponse.content}`];

  const updatedTurnState: MeetingTurnState = {
    turnCount: nextTurnCount,
    participantIndex: nextParticipantIndex,
    participantIds: turnState.participantIds,
    transcript: updatedTranscript,
  };

  const nextParticipantId = turnState.participantIds[nextParticipantIndex] ?? turnState.participantIds[0]!;

  return {
    pendingAssignments: [{
      taskType: '__meeting_state',
      employeeId: nextParticipantId,
      inputJson: updatedTurnState as unknown as Record<string, unknown>,
    }],
    messages: [new AIMessage({ content: `[${employee.name}]: ${llmResponse.content}` })],
  };
}

/**
 * Turn check — decides if meeting should continue or end.
 */
export function meetingTurnCheck(state: AicsGraphState): string {
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
 * Meeting end — produce summary and update meeting record.
 */
export async function meetingEndNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'meeting_end');
  }

  const { repos, eventBus, companyId, threadId } = runtimeCtx;
  const turnState = parseMeetingTurnState(state);

  const summaryJson = JSON.stringify({
    totalTurns: turnState.turnCount,
    participants: turnState.participantIds,
    transcript: turnState.transcript,
  });

  if (state.meetingId) {
    await repos.meetings.updateStatus(state.meetingId, 'ended', summaryJson);
    eventBus.emit(
      meetingStateChanged(companyId, state.meetingId, 'active', 'ended', turnState.participantIds, threadId),
    );
  }

  return {
    pendingAssignments: [],
    completed: true,
    messages: [
      new AIMessage({
        content: `[Meeting] Concluded after ${turnState.transcript.length} contributions from ${turnState.participantIds.length} participants.`,
      }),
    ],
  };
}
