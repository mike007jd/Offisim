import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphError } from '../errors.js';
import { graphNodeEntered } from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';

interface BossDecision {
  action: 'delegate' | 'direct_reply' | 'meeting' | 'hire_or_assess';
  reason?: string;
  reply?: string;
}

const BOSS_SYSTEM_PROMPT = `You are the Boss AI — the top-level coordinator of this company.

Analyze the user's message and decide how to handle it. Respond with JSON only:

{
  "action": "delegate" | "direct_reply" | "meeting" | "hire_or_assess",
  "reason": "brief explanation",
  "reply": "only if action is direct_reply"
}

Rules:
- "delegate": for tasks requiring employee work (coding, design, analysis, etc.)
- "direct_reply": for simple greetings, status questions, or things you can answer directly
- "meeting": when the user explicitly asks for a team meeting or discussion
- "hire_or_assess": for hiring requests, recruitment needs, team assessment, or staffing questions (e.g. "hire a designer", "what roles are we missing", "assess the team", "we need more people")`;

function parseBossDecision(content: string): BossDecision | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;

  const action = parsed.action;
  if (action === 'delegate' || action === 'direct_reply' || action === 'meeting' || action === 'hire_or_assess') {
    return {
      action,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      reply: typeof parsed.reply === 'string' ? parsed.reply : undefined,
    };
  }
  return null;
}

function mapActionToRoute(action: BossDecision['action']): AicsGraphState['routeDecision'] {
  switch (action) {
    case 'delegate':
    case 'hire_or_assess':
      return 'delegate_manager';
    case 'direct_reply':
      return 'direct_reply';
    case 'meeting':
      return 'start_meeting';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export async function bossNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'boss');
  }

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'boss'));

  const { modelResolver } = runtimeCtx;
  const resolved = modelResolver.resolve(null, 'boss');

  // Build messages for LLM — use last N human messages for multi-turn context
  const recentHumanMessages = state.messages
    .filter((m) => m._getType() === 'human')
    .slice(-3);

  const userContent =
    recentHumanMessages.length > 0
      ? recentHumanMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n---\n')
      : 'No user message found';

  const llmResponse = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        { role: 'system', content: BOSS_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    },
    { nodeName: 'boss', provider: resolved.provider, model: resolved.model },
  );

  const decision = parseBossDecision(llmResponse.content);

  // Fallback: if LLM didn't return valid JSON, default to delegate
  const route = decision ? mapActionToRoute(decision.action) : 'delegate_manager';

  const replyContent =
    decision?.action === 'direct_reply' && decision.reply
      ? decision.reply
      : (decision?.reason ?? llmResponse.content);

  return {
    routeDecision: route,
    messages: [new AIMessage({ content: replyContent })],
  };
}
