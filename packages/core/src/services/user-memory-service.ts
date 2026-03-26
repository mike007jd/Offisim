import { z } from 'zod';
import type { LlmGateway } from '../llm/gateway.js';
import { pruneLlmMessages } from '../llm/prune-messages.js';
import type {
  UserPreferenceCategory,
  UserPreferenceRepository,
  UserPreferenceRow,
} from '../runtime/repositories.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { Logger } from './logger.js';

const logger = new Logger('user-memory');

/** Zod schema for LLM-extracted user preferences */
const ExtractedPreferencesSchema = z.object({
  preferences: z.array(
    z.object({
      content: z.string().min(1),
      category: z.enum(['preference', 'context', 'knowledge', 'behavior', 'goal']),
      importance: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
});

const EXTRACT_PROMPT = `You are an assistant that extracts user preferences and context from a conversation.
Analyze the messages below and extract 0-3 facts about the user that would be useful in future conversations.

Focus on:
- "preference": how the user likes things done (e.g., "prefers concise reports", "likes code comments in Chinese")
- "context": the user's role, department, responsibilities (e.g., "works in marketing", "is a senior developer")
- "knowledge": domain expertise the user has (e.g., "experienced with TypeScript", "understands ML pipelines")
- "behavior": work patterns (e.g., "usually works late", "prefers async communication")
- "goal": current objectives (e.g., "preparing for Q2 launch", "optimizing build times")

Rules:
- Only extract genuinely stable/useful facts, not ephemeral task details
- Each fact should be self-contained and understandable out of context
- Assign importance 0.3-0.9 and confidence 0.5-0.95
- If nothing is worth remembering, return an empty array
- Do NOT extract facts about the AI employees — only about the human user

Respond ONLY with valid JSON:
{ "preferences": [{ "content": "...", "category": "...", "importance": 0.5, "confidence": 0.8 }] }

Conversation:
`;

/**
 * Extracts and manages user-level preferences from conversations.
 *
 * Inspired by DeerFlow's global memory system:
 * - Async fact extraction via LLM
 * - Deduplication via normalized content keys
 * - Reinforcement (same fact seen again → confidence boost)
 */
export class UserMemoryService {
  private pendingExtraction: Promise<void> | null = null;

  constructor(
    private readonly prefRepo: UserPreferenceRepository,
    private readonly llmGateway: LlmGateway,
    /** Model name to use for extraction LLM calls (e.g., 'gpt-4o-mini'). */
    private readonly extractionModel: string = 'gpt-4o-mini',
  ) {}

  /**
   * Extract user preferences from a completed conversation.
   * Called after boss_summary to capture user context from the session.
   * Non-blocking — fires and forgets.
   */
  extractFromConversation(
    companyId: string,
    conversationText: string,
    threadId: string,
  ): void {
    // Debounce: skip if already extracting
    if (this.pendingExtraction) return;

    this.pendingExtraction = this.doExtract(companyId, conversationText, threadId).finally(() => {
      this.pendingExtraction = null;
    });
  }

  /**
   * Save an explicit user preference (user said "remember that I...").
   */
  async saveExplicit(
    companyId: string,
    content: string,
    category: UserPreferenceCategory = 'preference',
    threadId?: string,
  ): Promise<UserPreferenceRow> {
    const dedupeKey = this.buildDedupeKey(content);

    // Check for duplicate
    const existing = await this.prefRepo.findByDedupeKey(companyId, dedupeKey);
    if (existing) {
      await this.prefRepo.reinforce(existing.preference_id);
      return { ...existing, reinforcement_count: existing.reinforcement_count + 1 };
    }

    return this.prefRepo.create({
      preference_id: generateId('up'),
      company_id: companyId,
      category,
      content,
      confidence: 0.95, // Explicit = high confidence
      importance: 0.7,
      source: 'explicit',
      dedupe_key: dedupeKey,
      source_thread_id: threadId,
    });
  }

  /**
   * Get all preferences for a company, scored and sorted.
   */
  async getPreferences(
    companyId: string,
    opts?: { category?: UserPreferenceCategory; limit?: number },
  ): Promise<UserPreferenceRow[]> {
    return this.prefRepo.findByCompany(companyId, opts);
  }

  /**
   * Delete a preference by ID.
   */
  async forget(preferenceId: string): Promise<void> {
    return this.prefRepo.delete(preferenceId);
  }

  private async doExtract(
    companyId: string,
    conversationText: string,
    threadId: string,
  ): Promise<void> {
    try {
      const messages = pruneLlmMessages(
        [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: conversationText },
        ],
        { maxNonSystemMessages: 4 },
      );

      const response = await this.llmGateway.chat({
        messages,
        model: this.extractionModel,
        temperature: 0.3,
        maxTokens: 500,
      });

      const parsed = extractJsonFromLlm(response.content);
      if (!parsed) return;

      const validated = ExtractedPreferencesSchema.safeParse(parsed);
      if (!validated.success) {
        logger.error('Invalid preference extraction schema', validated.error);
        return;
      }

      for (const pref of validated.data.preferences) {
        const dedupeKey = this.buildDedupeKey(pref.content);
        const existing = await this.prefRepo.findByDedupeKey(companyId, dedupeKey);

        if (existing) {
          await this.prefRepo.reinforce(existing.preference_id);
        } else {
          await this.prefRepo.create({
            preference_id: generateId('up'),
            company_id: companyId,
            category: pref.category,
            content: pref.content,
            confidence: pref.confidence ?? 0.7,
            importance: pref.importance,
            source: 'inferred',
            dedupe_key: dedupeKey,
            source_thread_id: threadId,
          });
        }
      }
    } catch (err) {
      logger.error('User preference extraction failed', err);
    }
  }

  /** Normalize content into a stable deduplication key. */
  private buildDedupeKey(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
      .trim()
      .slice(0, 200);
  }
}
