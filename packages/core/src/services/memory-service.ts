import { z } from 'zod';
import type { EventBus } from '../events/event-bus.js';
import { memoryCreated } from '../events/event-factories.js';
import type { LlmGateway } from '../llm/gateway.js';
import type { MemoryEntryRow, MemoryRepository } from '../runtime/repositories.js';

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
   * After task completion, asks LLM to extract worth-remembering insights.
   */
  async reflectAndRemember(
    employeeId: string,
    companyId: string,
    taskContent: string,
    threadId: string,
    opts?: { skip?: boolean },
  ): Promise<void> {
    if (opts?.skip) return;

    // Ask LLM to extract memories
    let rawResponse: string;
    try {
      const response = await this.llmGateway.chat({
        messages: [
          { role: 'system', content: REFLECT_PROMPT + taskContent },
          { role: 'user', content: 'Extract memories from the task above.' },
        ],
        model: 'default',
        temperature: 0.3,
        maxTokens: 1024,
      });
      rawResponse = response.content;
    } catch {
      // LLM failure during reflection is non-critical — skip silently
      return;
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonStr = this.extractJson(rawResponse);
    if (!jsonStr) return;

    const parsed = ExtractedMemorySchema.safeParse(JSON.parse(jsonStr));
    if (!parsed.success) return;

    // Create memory entries
    for (const mem of parsed.data.memories) {
      const memoryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await this.memoryRepo.create({
        memory_id: memoryId,
        company_id: companyId,
        scope: mem.scope,
        owner_id: mem.scope === 'employee' ? employeeId : companyId,
        category: mem.category,
        content: mem.content,
        importance: mem.importance,
        source_thread_id: threadId,
      });

      this.eventBus.emit(
        memoryCreated(
          companyId,
          memoryId,
          employeeId,
          mem.scope,
          mem.category,
          mem.content.slice(0, 100),
          threadId,
        ),
      );
    }
  }

  /** Recency factor: newer → higher score (exponential decay over 7 days) */
  private recencyFactor(accessedAt: string, now: number): number {
    const ageMs = now - new Date(accessedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Half-life of 7 days
    return Math.exp(-0.1 * ageDays);
  }

  /** Extract JSON from LLM response that may be wrapped in markdown code blocks */
  private extractJson(text: string): string | null {
    // Try direct parse first
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) return trimmed;

    // Try extracting from ```json ... ``` blocks
    const match = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (match?.[1]) return match[1].trim();

    return null;
  }
}
