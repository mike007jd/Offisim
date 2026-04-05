import type { AgentContextPack } from '@offisim/shared-types';
import type { NodeSummaryRepository } from '../../runtime/repositories.js';
import type { AgentContextPackService } from '../../services/agent-context-pack-service.js';
import type { LlmCallContext, LlmMiddleware } from '../types.js';

export interface NodeContextMiddlewareOptions {
  maxSummaries?: number;
  maxChars?: number;
  summaryBudget?: number;
  packBudget?: number;
}

const DEFAULT_MAX_SUMMARIES = 6;
const DEFAULT_MAX_CHARS = 1800;
const DEFAULT_SUMMARY_BUDGET = 1000;
const DEFAULT_PACK_BUDGET = 700;

function buildSummaryBlock(
  summaries: Awaited<ReturnType<NodeSummaryRepository['listByThread']>>,
  maxChars: number,
): string {
  if (summaries.length === 0) return '';
  let content = '## Execution Context (previous nodes)\n';
  for (const summary of [...summaries].reverse()) {
    const line = `- [${summary.node_name}${summary.employee_id ? `:${summary.employee_id}` : ''}] ${summary.summary_text}\n`;
    if (content.length + line.length > maxChars) break;
    content += line;
  }
  return content.trimEnd();
}

function buildPackBlock(pack: AgentContextPack, maxChars: number): string {
  let content = '## Runtime Context (current state)\n';

  if (pack.recommendedFocus) {
    const line = `Focus: ${pack.recommendedFocus}\n`;
    if (content.length + line.length > maxChars) return content.trimEnd();
    content += line;
  }

  if (pack.pendingInteraction) {
    const pi = pack.pendingInteraction;
    const line = `Pending: [${pi.kind}] ${pi.title}${pi.severity === 'high' ? ' (HIGH)' : ''}\n`;
    if (content.length + line.length > maxChars) return content.trimEnd();
    content += line;
  }

  if (pack.activeTaskRuns.length > 0) {
    const header = `Active tasks: ${pack.activeTaskRuns.length}\n`;
    if (content.length + header.length <= maxChars) {
      content += header;
      for (const task of pack.activeTaskRuns) {
        const line = `- [${task.status}] ${task.taskType}${task.employeeId ? ` (${task.employeeId})` : ''}\n`;
        if (content.length + line.length > maxChars) break;
        content += line;
      }
    }
  }

  // recentNodeSummaries are intentionally NOT rendered here —
  // the execution context block already covers them via buildSummaryBlock().

  return content.trimEnd();
}

export class NodeContextMiddleware implements LlmMiddleware {
  readonly name = 'node-context';
  readonly priority = 20;
  private readonly maxSummaries: number;
  private readonly maxChars: number;
  private readonly summaryBudget: number;
  private readonly packBudget: number;

  constructor(
    private readonly nodeSummaryRepo: NodeSummaryRepository,
    options: NodeContextMiddlewareOptions = {},
    private readonly packService?: AgentContextPackService,
  ) {
    this.maxSummaries = options.maxSummaries ?? DEFAULT_MAX_SUMMARIES;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    this.summaryBudget = options.summaryBudget ?? DEFAULT_SUMMARY_BUDGET;
    this.packBudget = options.packBudget ?? DEFAULT_PACK_BUDGET;
  }

  async before(ctx: LlmCallContext): Promise<LlmCallContext> {
    const summaries = await this.nodeSummaryRepo.listByThread(ctx.runtimeCtx.threadId, {
      limit: this.maxSummaries,
    });
    const pack = (await this.packService?.buildPack({ preloadedSummaries: summaries })) ?? null;

    const hasPackContent =
      pack &&
      (pack.pendingInteraction ||
        pack.activeTaskRuns.length > 0 ||
        pack.recentNodeSummaries.length > 0 ||
        pack.recommendedFocus);

    let effectiveSummaryBudget: number;
    let effectivePackBudget: number;

    if (summaries.length === 0 && !hasPackContent) {
      return ctx;
    }

    if (summaries.length === 0) {
      effectiveSummaryBudget = 0;
      effectivePackBudget = this.maxChars;
    } else if (!hasPackContent) {
      effectiveSummaryBudget = this.maxChars;
      effectivePackBudget = 0;
    } else {
      effectiveSummaryBudget = this.summaryBudget;
      effectivePackBudget = this.packBudget;
    }

    const parts: string[] = [];

    if (summaries.length > 0 && effectiveSummaryBudget > 0) {
      const summaryBlock = buildSummaryBlock(summaries, effectiveSummaryBudget);
      if (summaryBlock) parts.push(summaryBlock);
    }

    if (hasPackContent && pack && effectivePackBudget > 0) {
      const packBlock = buildPackBlock(pack, effectivePackBudget);
      if (packBlock) parts.push(packBlock);
    }

    if (parts.length === 0) return ctx;

    const contextBlock = parts.join('\n\n');
    if (contextBlock.length > this.maxChars) {
      // Hard cap: truncate the combined block
      return this.injectBlock(ctx, contextBlock.slice(0, this.maxChars));
    }

    return this.injectBlock(ctx, contextBlock);
  }

  private injectBlock(ctx: LlmCallContext, block: string): LlmCallContext {
    const messages = [...ctx.request.messages];
    const systemIndex = messages.findIndex((message) => message.role === 'system');
    if (systemIndex >= 0) {
      const existing = messages[systemIndex];
      if (!existing) return ctx;
      messages[systemIndex] = {
        ...existing,
        content: `${existing.content}\n\n${block}`,
      };
    } else {
      messages.unshift({ role: 'system', content: block });
    }

    return {
      ...ctx,
      request: {
        ...ctx.request,
        messages,
      },
    };
  }
}
