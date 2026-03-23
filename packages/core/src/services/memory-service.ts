import { z } from 'zod';
import type { EventBus } from '../events/event-bus.js';
import { Logger } from './logger.js';

const logger = new Logger('memory');
import { memoryCreated } from '../events/event-factories.js';
import type { LlmGateway } from '../llm/gateway.js';
import { pruneLlmMessages } from '../llm/prune-messages.js';
import type { MemoryEntryRow, MemoryRepository } from '../runtime/repositories.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';

/** Zod schema for LLM-extracted memories */
const ExtractedMemorySchema = z.object({
  memories: z.array(
    z.object({
      content: z.string().min(1),
      category: z.enum(['experience', 'decision', 'knowledge', 'preference']),
      scope: z.enum(['employee', 'team', 'company']),
      importance: z.number().min(0).max(1),
    }),
  ),
});

const REFLECT_PROMPT = `You are an AI assistant that extracts memories worth remembering from a completed task.
Analyze the task content below and extract 0-3 key insights that would be useful in future tasks.

Rules:
- Only extract genuinely useful insights, not trivial observations
- Each memory should be self-contained and understandable out of context
- Assign importance 0.0-1.0 (0.3=minor, 0.5=moderate, 0.7=important, 0.9=critical)
- Categories: experience (lessons learned), decision (choices made), knowledge (facts discovered), preference (user/team preferences)
- Scope: employee (personal learning), team (team-relevant), company (company-wide)
- If nothing is worth remembering, return an empty array

Respond ONLY with valid JSON matching this schema:
{ "memories": [{ "content": "...", "category": "...", "scope": "...", "importance": 0.0-1.0 }] }

Task content:
`;

/**
 * 3-layer agent memory service.
 * Manages memory retrieval, reflection, and storage.
 */
export class MemoryService {
  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly llmGateway: LlmGateway,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Retrieves relevant memories for an employee across all 3 scopes.
   * Merges employee + team + company memories, deduplicates, and sorts by relevance.
   */
  async getRelevantMemories(
    employeeId: string,
    companyId: string,
    query: string,
    limit = 10,
  ): Promise<MemoryEntryRow[]> {
    // Search across all 3 scopes in parallel
    const [employeeMemories, teamMemories, companyMemories] = await Promise.all([
      this.memoryRepo.search(query, {
        scope: 'employee',
        ownerId: employeeId,
        companyId,
        limit,
      }),
      this.memoryRepo.search(query, {
        scope: 'team',
        ownerId: companyId,
        companyId,
        limit,
      }),
      this.memoryRepo.search(query, {
        scope: 'company',
        ownerId: companyId,
        companyId,
        limit,
      }),
    ]);

    // Merge and deduplicate by memory_id
    const seen = new Set<string>();
    const all: MemoryEntryRow[] = [];
    for (const mem of [...employeeMemories, ...teamMemories, ...companyMemories]) {
      if (!seen.has(mem.memory_id)) {
        seen.add(mem.memory_id);
        all.push(mem);
      }
    }

    // Sort by relevance: importance * recency factor
    const now = Date.now();
    all.sort((a, b) => {
      const recencyA = this.recencyFactor(a.accessed_at, now);
      const recencyB = this.recencyFactor(b.accessed_at, now);
      return b.importance * recencyB - a.importance * recencyA;
    });

    return all.slice(0, limit);
  }

  /**
   * Store a single memory entry and emit event.
   * Used by virtual tool handler and reflectAndRemember.
   */
  async createMemory(params: {
    employeeId: string;
    companyId: string;
    scope: 'employee' | 'team' | 'company';
    category: 'experience' | 'decision' | 'knowledge' | 'preference';
    content: string;
    importance: number;
    threadId: string;
  }): Promise<string> {
    const memoryId = generateId('mem');
    await this.memoryRepo.create({
      memory_id: memoryId,
      company_id: params.companyId,
      scope: params.scope,
      owner_id: params.scope === 'employee' ? params.employeeId : params.companyId,
      category: params.category,
      content: params.content,
      importance: params.importance,
      source_thread_id: params.threadId,
    });

    this.eventBus.emit(
      memoryCreated(
        params.companyId,
        memoryId,
        params.employeeId,
        params.scope,
        params.category,
        params.content.slice(0, 100),
        params.threadId,
      ),
    );

    return memoryId;
  }

  /**
   * After task completion, asks LLM to extract worth-remembering insights.
   */
  async reflectAndRemember(
    employeeId: string,
    companyId: string,
    taskContent: string,
    threadId: string,
    opts?: { skip?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    if (opts?.skip) return;

    // Ask LLM to extract memories
    let rawResponse: string;
    try {
      const messages = pruneLlmMessages([
        { role: 'system', content: REFLECT_PROMPT + taskContent },
        { role: 'user', content: 'Extract memories from the task above.' },
      ]);
      const response = await this.llmGateway.chat({
        messages,
        model: 'default',
        temperature: 0.3,
        maxTokens: 1024,
        signal: opts?.signal,
      });
      rawResponse = response.content;
    } catch (error) {
      logger.error('reflectAndRemember failed', error, { employeeId });
      return;
    }

    // Extract JSON from response (handle markdown code blocks)
    const extracted = extractJsonFromLlm(rawResponse);
    if (!extracted) return;

    const parsed = ExtractedMemorySchema.safeParse(extracted);
    if (!parsed.success) return;

    // Create memory entries via shared method
    for (const mem of parsed.data.memories) {
      try {
        await this.createMemory({
          employeeId,
          companyId,
          scope: mem.scope,
          category: mem.category,
          content: mem.content,
          importance: mem.importance,
          threadId,
        });
      } catch (err) {
        logger.error('Failed to save memory', err, { employeeId });
        // Continue saving other memories
      }
    }
  }

  /** Recency factor: newer → higher score (exponential decay over 7 days) */
  private recencyFactor(accessedAt: string, now: number): number {
    const ageMs = now - new Date(accessedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Half-life of 7 days
    return Math.exp(-0.1 * ageDays);
  }
}
