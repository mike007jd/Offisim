import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AGENT_QUESTION_REQUIRED } from '@offisim/shared-types';
import { graphNodeEntered, llmStreamChunk } from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import { recordedLlmCall, recordedLlmStream } from '../llm/recorded-call.js';
import { ProjectService } from '../services/project-service.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';

interface BossDecision {
  action:
    | 'delegate'
    | 'direct_reply'
    | 'meeting'
    | 'hire_or_assess'
    | 'direct_delegate'
    | 'use_sop';
  reason?: string;
  reply?: string;
  isNewProject?: boolean;
  projectName?: string;
  /** Employee ID for direct_delegate — Boss picks a specific employee for simple tasks. */
  targetEmployeeId?: string;
  /** SOP template ID for use_sop — Boss picks a matching SOP. */
  sopTemplateId?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

/** @internal — exported for testing */
export const BOSS_SYSTEM_PROMPT = `You are the Boss AI — the top-level coordinator of this company.

Analyze the user's message and decide how to handle it. Respond with JSON only:

{
  "action": "delegate" | "direct_reply" | "meeting" | "hire_or_assess" | "direct_delegate" | "use_sop",
  "reason": "brief explanation",
  "reply": "only if action is direct_reply",
  "isNewProject": true | false,
  "projectName": "short name — only if isNewProject is true",
  "targetEmployeeId": "employee ID — only if action is direct_delegate",
  "sopTemplateId": "SOP template ID — only if action is use_sop",
  "needsClarification": true | false,
  "clarificationQuestion": "only when a critical detail is missing"
}

Rules:
- "delegate": for complex tasks requiring planning, multi-step work, or coordination between multiple employees
- "direct_reply": for simple greetings, status questions, or conversational messages that do NOT involve work. NEVER use direct_reply when the user asks someone to build, create, implement, write, design, fix, or perform any task.
- "direct_delegate": for straightforward single-employee tasks where you can immediately identify the right person. Use this when: (1) the task is simple and self-contained, (2) only one employee is clearly suited, (3) no multi-step planning is needed. You MUST include "targetEmployeeId" with the chosen employee's ID.
- "meeting": when the user explicitly asks for a team meeting or discussion
- "hire_or_assess": for hiring requests, recruitment needs, team assessment, or staffing questions (e.g. "hire a designer", "what roles are we missing", "assess the team", "we need more people")
- "isNewProject": set to true when the user describes a substantial project, multi-phase work, or long-term initiative (NOT a simple question or single task). Examples: "build a full e-commerce site", "launch a new product", "create a complete mobile app". Single tasks like "fix this bug" or "write a summary" should be false.
- "projectName": a concise 2-5 word name for the project (only when isNewProject is true)
- If a critical detail is missing and you cannot confidently route or scope the work, set "needsClarification": true and provide one concise "clarificationQuestion"
- When "needsClarification" is true, still choose the most likely action you would take after the user answers
- "use_sop": when the user's request closely matches an available SOP template. Use the SOP's predefined workflow instead of creating a new plan. You MUST include "sopTemplateId".
- When in doubt between "direct_delegate" and "delegate", prefer "delegate" — it is safer to plan than to skip planning.
- When an SOP matches, prefer "use_sop" over "delegate" — reusing a proven workflow is better than re-planning from scratch.

Decision priority (check in order):
1. Does the message mention a specific employee + a task? → direct_delegate
2. Does the message request work (build, create, implement, fix, write, etc.)? → delegate
3. Does the message match an available SOP? → use_sop
4. Is it about hiring or team assessment? → hire_or_assess
5. Is it a meeting request? → meeting
6. Everything else (greetings, status, conversation) → direct_reply

Examples:
User: "Ask Alex to implement a login page" → {"action":"direct_delegate","targetEmployeeId":"<Alex's ID>","reason":"single employee task"}
User: "Build a complete e-commerce platform" → {"action":"delegate","reason":"complex multi-step project","isNewProject":true,"projectName":"E-commerce Platform"}
User: "What's the team status?" → {"action":"direct_reply","reply":"...","reason":"status inquiry"}`;

const BOSS_DIRECT_REPLY_PROMPT = `You are the Boss AI speaking directly to the user.

Write the final user-facing reply. Do not return JSON.

Rules:
- Be concise, clear, and helpful
- Answer directly in natural language
- Do not mention internal routing, plans, or delegation logic
- If the user is greeting or asking a simple question, respond naturally and briefly`;

function parseBossDecision(content: string): BossDecision | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;

  const action = parsed.action;
  if (
    action === 'delegate' ||
    action === 'direct_reply' ||
    action === 'meeting' ||
    action === 'hire_or_assess' ||
    action === 'direct_delegate' ||
    action === 'use_sop'
  ) {
    return {
      action,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      reply: typeof parsed.reply === 'string' ? parsed.reply : undefined,
      isNewProject: parsed.isNewProject === true,
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : undefined,
      targetEmployeeId:
        typeof parsed.targetEmployeeId === 'string' ? parsed.targetEmployeeId : undefined,
      sopTemplateId: typeof parsed.sopTemplateId === 'string' ? parsed.sopTemplateId : undefined,
      needsClarification: parsed.needsClarification === true,
      clarificationQuestion:
        typeof parsed.clarificationQuestion === 'string' ? parsed.clarificationQuestion : undefined,
    };
  }
  return null;
}

function mapActionToRoute(action: BossDecision['action']): OffisimGraphState['routeDecision'] {
  switch (action) {
    case 'delegate':
    case 'hire_or_assess':
    case 'use_sop':
      return 'delegate_manager';
    case 'direct_reply':
      return 'direct_reply';
    case 'meeting':
      return 'start_meeting';
    case 'direct_delegate':
      return 'direct_delegate';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export async function bossNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'boss');

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'boss'));

  const { modelResolver } = runtimeCtx;
  const interactionService = runtimeCtx.interactionService;
  const interactionMode = interactionService?.getMode() ?? 'boss_proxy';
  const resolved = modelResolver.resolve(null, 'boss');

  // Build messages for LLM — use last N human messages for multi-turn context
  const recentHumanMessages = state.messages.filter((m) => m._getType() === 'human').slice(-3);

  const userContent =
    recentHumanMessages.length > 0
      ? recentHumanMessages
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .join('\n---\n')
      : 'No user message found';

  // Build employee roster + SOP list in parallel for the prompt
  const [employees, sopTemplates] = await Promise.all([
    runtimeCtx.repos.employees.findByCompany(runtimeCtx.companyId),
    runtimeCtx.repos.sopTemplates.findByCompany(runtimeCtx.companyId),
  ]);
  const nonManagerEmployees = employees.filter((e) => e.role_slug !== 'manager' && e.enabled !== 0);
  let rosterSection = '';
  if (nonManagerEmployees.length > 0) {
    const roster = nonManagerEmployees
      .map((e) => `- ${e.employee_id}: ${e.name} (${e.role_slug})`)
      .join('\n');
    rosterSection = `\n\nAvailable employees:\n${roster}`;
  }

  // Inject available SOPs so boss can choose use_sop when a match exists
  let sopSection = '';
  if (sopTemplates.length > 0) {
    const sopList = sopTemplates
      .map((s) => `- ${s.sop_template_id}: "${s.name}" — ${s.description || 'no description'}`)
      .join('\n');
    sopSection = `\n\nAvailable SOPs (reusable workflows):\n${sopList}`;
  }

  const llmResponse = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        { role: 'system', content: BOSS_SYSTEM_PROMPT + rosterSection + sopSection },
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
  let route = decision ? mapActionToRoute(decision.action) : 'delegate_manager';
  const needsClarification =
    decision?.needsClarification === true && typeof decision.clarificationQuestion === 'string';

  // Defensive override: catch weaker models that misroute task requests as direct_reply.
  if (route === 'direct_reply' && !needsClarification) {
    const TASK_KEYWORDS =
      /\b(build|create|implement|write|design|develop|fix|deploy|test|refactor|code|plan|launch|ship)\b/i;
    const lowerContent = userContent.toLowerCase();
    const mentionsEmployee = nonManagerEmployees.some((e) =>
      new RegExp(`\\b${e.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(
        lowerContent,
      ),
    );
    if (TASK_KEYWORDS.test(userContent) || mentionsEmployee) {
      route = 'delegate_manager';
    }
  }

  // Validate direct_delegate: must have a valid targetEmployeeId, otherwise fall back to delegate
  if (route === 'direct_delegate') {
    const validEmployeeIds = new Set(nonManagerEmployees.map((e) => e.employee_id));
    if (!decision?.targetEmployeeId || !validEmployeeIds.has(decision.targetEmployeeId)) {
      route = 'delegate_manager';
    }
  }

  // Validate use_sop: must have a valid sopTemplateId, otherwise fall back to delegate
  if (decision?.action === 'use_sop') {
    const validSopIds = new Set(sopTemplates.map((s) => s.sop_template_id));
    if (!decision.sopTemplateId || !validSopIds.has(decision.sopTemplateId)) {
      route = 'delegate_manager';
      decision.sopTemplateId = undefined;
    }
  }

  if (needsClarification && interactionService && interactionMode === 'human_in_loop') {
    const clarificationQuestion = decision?.clarificationQuestion ?? 'Could you clarify that?';
    await interactionService.request({
      interactionId: generateId('ix'),
      threadId: state.threadId,
      companyId: runtimeCtx.companyId,
      kind: 'agent_question',
      severity: 'normal',
      title: 'Need one clarification',
      prompt: clarificationQuestion,
      options: [
        { id: 'answer_and_continue', label: 'Answer and continue', recommended: true },
        { id: 'cancel', label: 'Cancel' },
      ],
      recommendation: {
        optionId: 'answer_and_continue',
        reason: 'One clear answer will let the boss choose the right path without guessing.',
      },
      allowFreeformResponse: true,
      placeholder: 'Answer the question so Offisim can continue',
      requestedByNode: 'boss',
      context: {
        type: 'agent_question',
        questionKey: 'boss_clarification',
      },
      createdAt: Date.now(),
    });
    throw new Error(AGENT_QUESTION_REQUIRED);
  }

  if (needsClarification) {
    route = 'direct_reply';
  }

  const replyContent =
    needsClarification && decision?.clarificationQuestion
      ? decision.clarificationQuestion
      : decision?.action === 'direct_reply' && decision.reply
        ? decision.reply
        : (decision?.reason ?? llmResponse.content);

  let finalReplyContent = replyContent;
  if (route === 'direct_reply') {
    const streamResult = await recordedLlmStream(
      runtimeCtx,
      {
        messages: [
          { role: 'system', content: BOSS_DIRECT_REPLY_PROMPT },
          {
            role: 'user',
            content: `User request:\n${userContent}\n\nPlanned response intent:\n${replyContent}`,
          },
        ],
        model: resolved.model,
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
        signal: getConfigSignal(config),
      },
      { nodeName: 'boss', provider: resolved.provider, model: resolved.model },
      (chunk) => {
        if (chunk.reasoning) {
          runtimeCtx.eventBus.emit(
            llmStreamChunk(runtimeCtx.companyId, state.threadId, 'boss', chunk.reasoning, 'reasoning'),
          );
        }
        if (chunk.content) {
          runtimeCtx.eventBus.emit(
            llmStreamChunk(runtimeCtx.companyId, state.threadId, 'boss', chunk.content),
          );
        }
      },
    );
    finalReplyContent = streamResult.fullContent.trim() || replyContent;
  }

  // Project intent detection — create a project when the boss flags a substantial initiative
  let projectId: string | null = state.projectId ?? null;
  if (decision?.isNewProject && decision.projectName && !state.projectId) {
    const projectService = new ProjectService(runtimeCtx);
    const project = await projectService.createProject(
      decision.projectName,
      // Pass the user's original message as description for context
      finalReplyContent,
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
  const messageContent =
    route === 'direct_reply' ? `[Boss]: ${finalReplyContent}` : finalReplyContent;

  return {
    routeDecision: route,
    messages: [new AIMessage({ content: messageContent })],
    ...(projectId !== (state.projectId ?? null) ? { projectId } : {}),
    // For direct_delegate, set targetEmployeeId so employee_direct_setup can use it
    ...(route === 'direct_delegate' && decision?.targetEmployeeId
      ? { targetEmployeeId: decision.targetEmployeeId }
      : {}),
    // For use_sop, pass the selected SOP template ID so PM planner can use it
    ...(decision?.action === 'use_sop' && decision.sopTemplateId
      ? { selectedSopTemplateId: decision.sopTemplateId }
      : {}),
  };
}
