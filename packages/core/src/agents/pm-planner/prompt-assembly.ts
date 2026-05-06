import type { RunnableConfig } from '@langchain/core/runnables';
import { recordedLlmCall } from '../../llm/recorded-call.js';
import { getRunScope } from '../../utils/get-runtime.js';
import { getConfigSignal } from '../../utils/get-signal.js';
import { buildAttachmentSystemPreface } from '../attachment-preface.js';
import { buildEnrichedEmployeeList } from '../employee-roster.js';
import type { PmPreflightReady } from '../pm-planner-types.js';

const PM_PLANNING_TIMEOUT_MS = 45_000;

/** @internal — exported for testing */
export const PM_SYSTEM_PROMPT = `You are the PM AI — responsible for breaking down work into structured execution plans.

Given the user's intent and available employees with their capabilities, create a step-by-step plan.

Respond with JSON only:
{
  "summary": "one sentence describing the overall plan",
  "steps": [
    {
      "stepIndex": 0,
      "phase": "phase name (optional, for grouping related steps)",
      "description": "what this step accomplishes",
      "dependsOnSteps": [],
      "tasks": [
        {
          "taskType": "research" | "writing" | "analysis" | "review" | "code" | "general",
          "employeeId": "<employee_id>",
          "description": "specific instruction for the employee",
          "dependsOnStepOutput": false,
          "requiredSkills": ["optional relevant skill keyword"]
        }
      ]
    }
  ]
}

Rules:
- Steps execute sequentially by stepIndex order
- Tasks within a step execute in parallel
- Set dependsOnStepOutput: true when a task needs results from the previous step
- Assign tasks to the most appropriate employee
- When assigning tasks, consider employee expertise and skills
- If an employee's installed skill package is relevant, mention that alignment in the task description
- Add requiredSkills when a task clearly benefits from a specific skill package or specialty
- For simple requests: 1-4 steps
- For complex projects: use phases to group related steps (e.g. "研究", "设计", "开发", "测试")
- dependsOnSteps is reserved for future parallel step execution — set it accurately but steps still run in order`;

async function loadExperienceSection(prep: PmPreflightReady): Promise<string> {
  const { runtimeCtx, directive } = prep;
  if (!runtimeCtx.memoryService) return '';
  try {
    const experiences = await runtimeCtx.memoryService.getRelevantMemories(
      'pm',
      runtimeCtx.companyId,
      directive.intent,
      5,
    );
    const companyExperiences = experiences.filter(
      (m) => m.scope === 'company' && m.category === 'experience',
    );
    if (companyExperiences.length === 0) return '';
    return `\n\nPast project experience (use as guidance, not rules):\n${companyExperiences
      .map((m) => `- ${m.content}`)
      .join('\n')}`;
  } catch {
    return '';
  }
}

/**
 * Run the LLM plan generation step: fetch relevant company experience, build prompt
 * messages, call the recorded LLM gateway, return raw response content for parsing.
 */
export async function generatePmLlmContent(
  prep: PmPreflightReady,
  config: RunnableConfig,
): Promise<string> {
  const { runtimeCtx, directive, validEmployees, planRevisionNote } = prep;
  const employeeList = buildEnrichedEmployeeList(validEmployees);
  const experienceSection = await loadExperienceSection(prep);
  const attachmentPreface = buildAttachmentSystemPreface(runtimeCtx, getRunScope(config));
  const resolved = runtimeCtx.modelResolver.resolve(null, 'pm');

  const response = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        {
          role: 'system',
          content: `${PM_SYSTEM_PROMPT}\n\nAvailable employees:\n${employeeList}${experienceSection}${attachmentPreface}`,
        },
        {
          role: 'user',
          content:
            `Intent: ${directive.intent}` +
            `${directive.constraints ? `\nConstraints: ${directive.constraints}` : ''}` +
            `${planRevisionNote ? `\nPlan revision request: ${planRevisionNote}` : ''}`,
        },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: Math.min(resolved.maxTokens, 2048),
      signal: getConfigSignal(config),
      timeoutMs: PM_PLANNING_TIMEOUT_MS,
    },
    { nodeName: 'pm_planner', provider: resolved.provider, model: resolved.model },
  );

  return response.content;
}
