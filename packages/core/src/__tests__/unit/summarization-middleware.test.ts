import { describe, expect, it, vi } from 'vitest';
import type { LlmRequest } from '../../llm/gateway.js';
import { SummarizationMiddleware } from '../../middleware/builtin/summarization-middleware.js';
import type { LlmCallContext, LlmMiddleware } from '../../middleware/types.js';
import type { ConversationBudgetService } from '../../services/conversation-budget-service.js';

function makeCtx(messages?: LlmRequest['messages']): LlmCallContext {
  return {
    request: {
      messages: messages ?? [
        { role: 'system', content: 'You are the Boss AI.' },
        { role: 'user', content: 'Help me build something' },
      ],
      model: 'test-model',
    },
    runtimeCtx: {
      companyId: 'c-1',
      threadId: 't-1',
    } as unknown as LlmCallContext['runtimeCtx'],
    meta: { nodeName: 'boss', provider: 'test', model: 'test-model' },
    extras: {},
  };
}

function makeMockBudgetService(
  prepareRequestImpl?: ConversationBudgetService['prepareRequest'],
): ConversationBudgetService {
  return {
    prepareRequest:
      prepareRequestImpl ??
      vi.fn(async (_ctx, req: LlmRequest) => ({
        ...req,
        messages: req.messages.slice(-1), // Simulate pruning
      })),
  } as unknown as ConversationBudgetService;
}

describe('SummarizationMiddleware', () => {
  it('has name "summarization"', () => {
    const mw = new SummarizationMiddleware(makeMockBudgetService());
    expect(mw.name).toBe('summarization');
  });

  it('has priority 10', () => {
    const mw = new SummarizationMiddleware(makeMockBudgetService());
    expect(mw.priority).toBe(10);
  });

  it('does not define an after hook', () => {
    const mw: LlmMiddleware = new SummarizationMiddleware(makeMockBudgetService());
    expect(mw.after).toBeUndefined();
  });

  it('delegates to ConversationBudgetService.prepareRequest in before()', async () => {
    const prepareRequest = vi.fn(async (_ctx: unknown, req: LlmRequest) => ({
      ...req,
      messages: [{ role: 'system' as const, content: 'pruned' }],
    }));
    const service = makeMockBudgetService(prepareRequest);
    const mw = new SummarizationMiddleware(service);

    const ctx = makeCtx();
    const result = await mw.before(ctx);

    expect(prepareRequest).toHaveBeenCalledOnce();
    expect(prepareRequest).toHaveBeenCalledWith(ctx.runtimeCtx, ctx.request);
    expect(result.request.messages).toEqual([{ role: 'system', content: 'pruned' }]);
  });

  it('preserves other context fields', async () => {
    const service = makeMockBudgetService();
    const mw = new SummarizationMiddleware(service);
    const ctx = makeCtx();
    ctx.extras = { foo: 'bar' };

    const result = await mw.before(ctx);

    expect(result.meta).toBe(ctx.meta);
    expect(result.runtimeCtx).toBe(ctx.runtimeCtx);
    expect(result.extras).toEqual({ foo: 'bar' });
  });
});
