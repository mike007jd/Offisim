import type { NodeSummaryRepository } from '../../runtime/repositories.js';
import type { LlmCallContext, LlmMiddleware } from '../types.js';

export interface NodeContextMiddlewareOptions {
  maxSummaries?: number;
  maxChars?: number;
}

const DEFAULT_MAX_SUMMARIES = 6;
const DEFAULT_MAX_CHARS = 1400;

function buildContextBlock(
  summaries: Awaited<ReturnType<NodeSummaryRepository['listByThread']>>,
  maxChars: number,
): string {
  let content = '## Execution Context (previous nodes)\n';
  for (const summary of [...summaries].reverse()) {
    const line = `- [${summary.node_name}${summary.employee_id ? `:${summary.employee_id}` : ''}] ${summary.summary_text}\n`;
    if (content.length + line.length > maxChars) break;
    content += line;
  }
  return content.trimEnd();
}

export class NodeContextMiddleware implements LlmMiddleware {
  readonly name = 'node-context';
  readonly priority = 20;
  private readonly maxSummaries: number;
  private readonly maxChars: number;

  constructor(
    private readonly nodeSummaryRepo: NodeSummaryRepository,
    options: NodeContextMiddlewareOptions = {},
  ) {
    this.maxSummaries = options.maxSummaries ?? DEFAULT_MAX_SUMMARIES;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  }

  async before(ctx: LlmCallContext): Promise<LlmCallContext> {
    const summaries = await this.nodeSummaryRepo.listByThread(ctx.runtimeCtx.threadId, {
      limit: this.maxSummaries,
    });
    if (summaries.length === 0) return ctx;

    const contextBlock = buildContextBlock(summaries, this.maxChars);
    if (!contextBlock) return ctx;

    const messages = [...ctx.request.messages];
    const systemIndex = messages.findIndex((message) => message.role === 'system');
    if (systemIndex >= 0) {
      const existing = messages[systemIndex];
      if (!existing) return ctx;
      messages[systemIndex] = {
        ...existing,
        content: `${existing.content}\n\n${contextBlock}`,
      };
    } else {
      messages.unshift({ role: 'system', content: contextBlock });
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
