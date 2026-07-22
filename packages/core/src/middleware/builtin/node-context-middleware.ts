import type { NodeSummaryRepository } from '../../runtime/repositories.js';
import type { LlmCallContext, LlmMiddleware } from '../types.js';

export interface NodeContextMiddlewareOptions {
  maxSummaries?: number;
  maxChars?: number;
}

const DEFAULT_MAX_SUMMARIES = 6;
const DEFAULT_MAX_CHARS = 1800;

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
    const contextBlock = buildSummaryBlock(summaries, this.maxChars);
    return contextBlock ? this.injectBlock(ctx, contextBlock) : ctx;
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
