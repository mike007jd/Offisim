import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { graphNodeEntered } from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import { ProjectService } from '../services/project-service.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';

interface BossDecision {
  action: 'delegate' | 'direct_reply' | 'meeting' | 'hire_or_assess';
  reason?: string;
  reply?: string;
  isNewProject?: boolean;
  projectName?: string;
}

/** @internal — exported for testing */
export const BOSS_SYSTEM_PROMPT = `You are the Boss AI — the top-level coordinator of this company.

Analyze the user's message and decide how to handle it. Respond with JSON only:

{
  "action": "delegate" | "direct_reply" | "meeting" | "hire_or_assess",
  "reason": "brief explanation",
  "reply": "only if action is direct_reply",
  "isNewProject": true | false,
  "projectName": "short name — only if isNewProject is true"
}

Rules:
- "delegate": for tasks requiring employee work (coding, design, analysis, etc.)
- "direct_reply": for simple greetings, status questions, or things you can answer directly
- "meeting": when the user explicitly asks for a team meeting or discussion
- "hire_or_assess": for hiring requests, recruitment needs, team assessment, or staffing questions (e.g. "hire a designer", "what roles are we missing", "assess the team", "we need more people")
- "isNewProject": set to true when the user describes a substantial project, multi-phase work, or long-term initiative (NOT a simple question or single task). Examples: "build a full e-commerce site", "launch a new product", "create a complete mobile app". Single tasks like "fix this bug" or "write a summary" should be false.
- "projectName": a concise 2-5 word name for the project (only when isNewProject is true)`;

function parseBossDecision(content: string): BossDecision | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;

  const action = parsed.action;
  if (
    action === 'delegate' ||
    action === 'direct_reply' ||
    action === 'meeting' ||
    action === 'hire_or_assess'
  ) {
    return {
      action,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      reply: typeof parsed.reply === 'string' ? parsed.reply : undefined,
      isNewProject: parsed.isNewProject === true,
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : undefined,
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
  const runtimeCtx = getRuntime(config, 'boss');

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'boss'));

  const { modelResolver } = runtimeCtx;
  const resolved = modelResolver.resolve(null, 'boss');

  // Build messages for LLM — use last N human messages for multi-turn context
  const recentHumanMessages = state.messages.filter((m) => m._getType() === 'human').slice(-3);

  const userContent =
    recentHumanMessages.length > 0
      ? recentHumanMessages
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .join('\n---\n')
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
      signal: getConfigSignal(config),
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

  // Project intent detection — create a project when the boss flags a substantial initiative
  let projectId: string | null = state.projectId ?? null;
  if (decision?.isNewProject && decision.projectName && !state.projectId) {
    const projectService = new ProjectService(runtimeCtx);
    const project = await projectService.createProject(
      decision.projectName,
      // Pass the user's original message as description for context
      replyContent,
    );
    projectId = project.project_id;
  }

  await appendAgentEvent(runtimeCtx, {
    projectId: projectId,
    threadId: state.threadId,
    agentName: 'boss',
    eventType: 'decision',
    payload: {
      action: decision?.action ?? 'delegate',
      reason: decision?.reason,
      isNewProject: decision?.isNewProject,
      projectName: decision?.projectName,
    },
  });

  // Prefix direct_reply messages with [Boss]: so the UI can display agent identity.
  // Non-direct-reply messages are consumed by downstream graph nodes and don't need the prefix.
  const messageContent = route === 'direct_reply' ? `[Boss]: ${replyContent}` : replyContent;

  return {
    routeDecision: route,
    messages: [new AIMessage({ content: messageContent })],
    ...(projectId !== (state.projectId ?? null) ? { projectId } : {}),
  };
}
