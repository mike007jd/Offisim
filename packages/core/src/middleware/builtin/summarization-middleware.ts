import type { ConversationBudgetService } from '../../services/conversation-budget-service.js';
import type { LlmCallContext, LlmMiddleware } from '../types.js';

/**
 * Wraps ConversationBudgetService as an LlmMiddleware.
 * Handles message pruning + LLM-driven synopsis generation.
 * Priority 10 — runs before UserPreferenceMiddleware (50).
 */
export class SummarizationMiddleware implements LlmMiddleware {
  readonly name = 'summarization';
  readonly priority = 10;

  constructor(private readonly budgetService: ConversationBudgetService) {}

  async before(ctx: LlmCallContext): Promise<LlmCallContext> {
    const prunedRequest = await this.budgetService.prepareRequest(ctx.runtimeCtx, ctx.request, {
      forceFullCompact: ctx.extras.forceFullCompact === true,
    });
    return { ...ctx, request: prunedRequest };
  }
}
