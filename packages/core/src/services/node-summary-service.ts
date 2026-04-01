import type { OffisimGraphState, StepTaskOutput } from '../graph/state.js';
import type {
  LlmCallRow,
  McpAuditRow,
  NewNodeSummary,
  NodeSummaryRepository,
  NodeSummaryRow,
} from '../runtime/repositories.js';
import { generateId } from '../utils/generate-id.js';

interface RecordNodeSummaryInput {
  threadId: string;
  companyId: string;
  nodeName: string;
  preState: Partial<OffisimGraphState>;
  postState: Partial<OffisimGraphState>;
  nodeOutput: Partial<OffisimGraphState>;
  llmCalls: LlmCallRow[];
  mcpAudits: McpAuditRow[];
  durationMs: number;
}

function uniqueStrings(values: Iterable<string | null | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))];
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function parseFilePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.includes('/')) return null;
  return value;
}

function extractFilePaths(audits: readonly McpAuditRow[]): string[] {
  const filePaths: string[] = [];
  for (const audit of audits) {
    try {
      const parsed = JSON.parse(audit.arguments_json) as Record<string, unknown>;
      const candidates = [
        parsed.file_path,
        parsed.filePath,
        parsed.path,
        parsed.target_path,
        parsed.targetPath,
      ];
      for (const candidate of candidates) {
        const filePath = parseFilePath(candidate);
        if (filePath) filePaths.push(filePath);
      }
    } catch {
      // Ignore malformed JSON — audit logs should not block summary creation.
    }
  }
  return uniqueStrings(filePaths);
}

function extractNewOutputs(
  preOutputs: readonly StepTaskOutput[] | undefined,
  postOutputs: readonly StepTaskOutput[] | undefined,
): StepTaskOutput[] {
  const start = preOutputs?.length ?? 0;
  return postOutputs ? postOutputs.slice(start) : [];
}

export class NodeSummaryService {
  constructor(private readonly nodeSummaryRepo: NodeSummaryRepository) {}

  async recordNodeSummary(input: RecordNodeSummaryInput): Promise<NodeSummaryRow> {
    const row = this.buildSummary(input);
    return this.nodeSummaryRepo.create(row);
  }

  private buildSummary(input: RecordNodeSummaryInput): NewNodeSummary {
    const { preState, postState, nodeOutput, nodeName, threadId, companyId, llmCalls, mcpAudits } =
      input;
    const toolsUsed = uniqueStrings(mcpAudits.map((audit) => audit.tool_name));
    const filesTouched = extractFilePaths(mcpAudits);
    const messageCount = nodeOutput.messages?.length ?? 0;
    const inputTokenCount = llmCalls.reduce((sum, call) => sum + call.input_tokens, 0);
    const outputTokenCount = llmCalls.reduce((sum, call) => sum + call.output_tokens, 0);
    const employeeId = postState.currentEmployeeId ?? preState.currentEmployeeId ?? null;
    const stepIndex = this.resolveStepIndex(nodeName, preState, postState);
    const decisions = this.buildDecisions(nodeName, preState, postState, toolsUsed);
    const summaryText = this.buildSummaryText({
      nodeName,
      preState,
      postState,
      nodeOutput,
      toolsUsed,
      filesTouched,
    });

    return {
      summary_id: generateId('ns'),
      thread_id: threadId,
      company_id: companyId,
      node_name: nodeName,
      employee_id: employeeId,
      step_index: stepIndex,
      summary_text: summaryText,
      decisions_json: JSON.stringify(decisions),
      files_touched_json: JSON.stringify(filesTouched),
      tools_used_json: JSON.stringify(toolsUsed),
      input_token_count: inputTokenCount,
      output_token_count: outputTokenCount,
      message_count: messageCount,
      duration_ms: input.durationMs,
      created_at: new Date().toISOString(),
    };
  }

  private resolveStepIndex(
    nodeName: string,
    preState: Partial<OffisimGraphState>,
    postState: Partial<OffisimGraphState>,
  ): number | null {
    const candidate = postState.currentStepIndex ?? preState.currentStepIndex;
    if (typeof candidate !== 'number') return null;
    return ['employee', 'step_dispatcher', 'step_advance', 'pm_replan'].includes(nodeName)
      ? candidate
      : null;
  }

  private buildDecisions(
    nodeName: string,
    preState: Partial<OffisimGraphState>,
    postState: Partial<OffisimGraphState>,
    toolsUsed: readonly string[],
  ): string[] {
    if (nodeName === 'boss') {
      const route = postState.routeDecision ?? preState.routeDecision;
      return route ? [`route:${route}`] : [];
    }
    if (nodeName === 'pm_planner') {
      return (
        postState.taskPlan?.steps
          .slice(0, 5)
          .map((step) => `step:${step.stepIndex}:${step.description}`) ?? []
      );
    }
    if (nodeName === 'employee') {
      const stepIndex = postState.currentStepIndex ?? preState.currentStepIndex;
      const decisions = typeof stepIndex === 'number' ? [`step:${stepIndex}:completed`] : [];
      return [...decisions, ...toolsUsed.map((tool) => `tool:${tool}`)];
    }
    return [];
  }

  private buildSummaryText(input: {
    nodeName: string;
    preState: Partial<OffisimGraphState>;
    postState: Partial<OffisimGraphState>;
    nodeOutput: Partial<OffisimGraphState>;
    toolsUsed: readonly string[];
    filesTouched: readonly string[];
  }): string {
    const { nodeName, preState, postState, nodeOutput, toolsUsed, filesTouched } = input;
    const deltaMessages = nodeOutput.messages ?? [];
    const lastMessageText = truncate(
      stringifyMessageContent(deltaMessages.at(-1)?.content ?? ''),
      200,
    );

    if (nodeName === 'boss') {
      const route = postState.routeDecision ?? preState.routeDecision ?? 'unknown';
      return `Boss routed to ${route}.${lastMessageText ? ` Output: ${lastMessageText}` : ''}`;
    }

    if (nodeName === 'pm_planner') {
      const planSteps = postState.taskPlan?.steps.length ?? 0;
      return `PM generated plan with ${planSteps} steps.`;
    }

    if (nodeName === 'step_dispatcher') {
      const assignments = postState.pendingAssignments?.length ?? 0;
      return `Step dispatcher queued ${assignments} assignment${assignments === 1 ? '' : 's'}.`;
    }

    if (nodeName === 'employee') {
      const employeeId = postState.currentEmployeeId ?? preState.currentEmployeeId ?? 'unknown';
      const stepIndex = postState.currentStepIndex ?? preState.currentStepIndex;
      const newOutputs = extractNewOutputs(
        preState.currentStepOutputs,
        postState.currentStepOutputs,
      );
      const latestConclusion =
        newOutputs.at(-1)?.content ?? lastMessageText ?? 'No conclusion recorded.';
      const conclusion = truncate(latestConclusion, 200);
      const toolText = toolsUsed.length > 0 ? ` Tools: ${toolsUsed.join(', ')}.` : '';
      const fileText = filesTouched.length > 0 ? ` Files: ${filesTouched.join(', ')}.` : '';
      const stepText = typeof stepIndex === 'number' ? ` step ${stepIndex}` : ' current work';
      return `Employee ${employeeId} completed${stepText}.${toolText}${fileText} Conclusion: ${conclusion}`;
    }

    if (nodeName === 'boss_summary') {
      return `Boss summary completed.${lastMessageText ? ` Output: ${lastMessageText}` : ''}`;
    }

    return lastMessageText || `${nodeName} completed.`;
  }
}
