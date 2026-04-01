import type { UserPreferenceRepository } from '../../runtime/repositories.js';
import { Logger } from '../../services/logger.js';
import { scoreMemoryEntry } from '../../utils/memory-scoring.js';
import type { LlmCallContext, LlmMiddleware } from '../types.js';

const logger = new Logger('user-pref-mw');

/** Maximum tokens to budget for user preference injection. */
const MAX_INJECTION_CHARS = 2000;

/** Maximum number of facts to inject. */
const MAX_FACTS = 15;

/**
 * Middleware that injects user preferences into the system prompt.
 *
 * Reads from UserPreferenceRepository, selects top-N by score,
 * and prepends a "User preferences" section to the system message.
 *
 * Priority 50 — runs after budget middleware but before the LLM call.
 */
export class UserPreferenceMiddleware implements LlmMiddleware {
  readonly name = 'user-preference';
  readonly priority = 50;

  constructor(private readonly userPrefRepo: UserPreferenceRepository) {}

  async before(ctx: LlmCallContext): Promise<LlmCallContext> {
    const { runtimeCtx, request } = ctx;

    try {
      const allPrefs = await this.userPrefRepo.findByCompany(runtimeCtx.companyId, {
        limit: MAX_FACTS * 2, // Fetch more than needed, then score-filter
      });

      if (allPrefs.length === 0) return ctx;

      // Score and select top N
      const scored = allPrefs
        .map((p) => ({ pref: p, score: scoreMemoryEntry(p, p.accessed_at) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_FACTS);

      // Build injection text
      let injectionText = '\n\n[User preferences — adapt your behavior accordingly]\n';
      let charCount = injectionText.length;

      for (const { pref } of scored) {
        const line = `- [${pref.category}] ${pref.content}\n`;
        if (charCount + line.length > MAX_INJECTION_CHARS) break;
        injectionText += line;
        charCount += line.length;

        // Touch access count (fire-and-forget)
        this.userPrefRepo.touchAccess(pref.preference_id).catch((err) => {
          logger.error('touchAccess failed', err);
        });
      }

      // Inject into the first system message, or prepend a new one
      const messages = [...request.messages];
      const systemIdx = messages.findIndex((m) => m.role === 'system');

      if (systemIdx >= 0) {
        const existing = messages[systemIdx];
        if (!existing) return ctx;
        messages[systemIdx] = {
          ...existing,
          content: existing.content + injectionText,
        };
      } else {
        messages.unshift({ role: 'system', content: injectionText.trim() });
      }

      return { ...ctx, request: { ...request, messages } };
    } catch (err) {
      logger.error('Failed to inject user preferences', err);
      return ctx;
    }
  }
}
