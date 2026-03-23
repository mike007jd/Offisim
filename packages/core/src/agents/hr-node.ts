import { ROLE_REGISTRY } from '@aics/shared-types';
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  graphNodeEntered,
  hrAssessmentCompleted,
  hrAssessmentStarted,
  hrRecommendation,
} from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { getRuntime } from '../utils/get-runtime.js';

interface HrAssessmentResult {
  assessment: string;
  suggestedRoles?: string[];
}

/** Build the HR system prompt with the canonical role slug list from ROLE_REGISTRY. */
const HIREABLE_SLUGS = ROLE_REGISTRY.filter((r) => !r.isSystem).map((r) => r.slug);

const HR_SYSTEM_PROMPT = `You are the HR Advisor AI — responsible for team composition analysis, recruitment assessment, and onboarding guidance.

Given the current team roster and the request, provide your assessment. Respond with JSON only:

{
  "assessment": "your detailed assessment and recommendations",
  "suggestedRoles": ["role_slug_1", "role_slug_2"]
}

Rules:
- For hiring intents: evaluate what roles are missing, suggest ideal candidate profiles
- For team assessment: analyze current team strengths/weaknesses, identify skill gaps
- For onboarding: provide context about team dynamics and working patterns
- Be specific and actionable in your recommendations
- suggestedRoles MUST use canonical role_slug values: ${HIREABLE_SLUGS.join(', ')}`;

function parseHrAssessment(content: string): HrAssessmentResult | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;

  if (typeof parsed.assessment !== 'string') return null;

  return {
    assessment: parsed.assessment,
    suggestedRoles: Array.isArray(parsed.suggestedRoles)
      ? (parsed.suggestedRoles.filter((r) => typeof r === 'string') as string[])
      : undefined,
  };
}

/**
 * HR node — advisory system agent for team composition, recruitment, and onboarding.
 *
 * Routes:
 * - Manager → HR (when managerDirective.action === 'hire' or 'assess_team')
 * - HR → Boss Summary (returns assessment result)
 *
 * HR does NOT execute tasks or call tools — it is an advisory node.
 */
export async function hrNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = getRuntime(config, 'hr');

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'hr'));

  const { repos, modelResolver, eventBus, companyId } = runtimeCtx;

  // Determine HR action from the managerDirective or infer from user message
  const hrAction: 'hire' | 'assess_team' =
    state.managerDirective?.constraints === 'hire' ? 'hire' : 'assess_team';

  eventBus.emit(hrAssessmentStarted(companyId, hrAction, state.threadId));

  // Get current team roster for context
  const employees = await repos.employees.findByCompany(companyId);
  const teamRoster = employees
    .filter((e) => e.enabled)
    .map((e) => {
      let persona: Record<string, unknown> = {};
      try { persona = JSON.parse(e.persona_json ?? '{}'); } catch { /* use default */ }
      return `- ${e.name} (${e.role_slug}): ${(persona.expertise as string) ?? 'no expertise listed'}`;
    })
    .join('\n');

  // Get last user message for context
  const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === 'human');
  const userContent =
    typeof lastUserMessage?.content === 'string'
      ? lastUserMessage.content
      : 'No user message found';

  const managerIntent = state.managerDirective?.intent ?? userContent;

  const resolved = modelResolver.resolve(null, 'hr');

  const llmResponse = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        {
          role: 'system',
          content: `${HR_SYSTEM_PROMPT}\n\nCurrent team roster (${employees.length} employees):\n${teamRoster || '(empty team)'}`,
        },
        {
          role: 'user',
          content: `Action: ${hrAction}\nRequest: ${managerIntent}`,
        },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      signal: getConfigSignal(config),
    },
    { nodeName: 'hr', provider: resolved.provider, model: resolved.model },
  );

  const result = parseHrAssessment(llmResponse.content);

  const assessmentText = result?.assessment ?? llmResponse.content;

  // Emit completion events
  eventBus.emit(hrAssessmentCompleted(companyId, hrAction, assessmentText, state.threadId));

  if (result?.suggestedRoles && result.suggestedRoles.length > 0) {
    eventBus.emit(
      hrRecommendation(companyId, assessmentText, result.suggestedRoles, state.threadId),
    );
  }

  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: 'hr',
    eventType: 'decision',
    payload: { action: hrAction, suggestedRoles: result?.suggestedRoles, assessmentLength: assessmentText.length },
  });

  return {
    hrAssessment: assessmentText,
    messages: [new AIMessage({ content: `[HR Assessment] ${assessmentText}` })],
  };
}
