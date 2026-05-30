import type { RuntimeMemoryPolicy } from '@offisim/shared-types';
import { z } from 'zod';
import type { EventBus } from '../events/event-bus.js';
import { Logger } from './logger.js';

const logger = new Logger('memory');
import { memoryCreated } from '../events/event-factories.js';
import type { LlmGateway, LlmRequest } from '../llm/gateway.js';
import { pruneLlmMessages } from '../llm/prune-messages.js';
import type { RecordedSystemLlmCaller } from '../llm/recorded-system-caller.js';
import type { MemoryEntryRow, MemoryRepository } from '../runtime/repositories.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { MemoryUpdateQueueService } from './memory-update-queue-service.js';

/** Zod schema for LLM-extracted memories */
const ExtractedMemorySchema = z.object({
  memories: z.array(
    z.object({
      content: z.string().min(1),
      category: z.enum(['experience', 'decision', 'knowledge', 'preference']),
      scope: z.enum(['employee', 'team', 'company']),
      importance: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1).optional(),
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
  private readonly queue: MemoryUpdateQueueService;
  private readonly policy: RuntimeMemoryPolicy;

  private readonly systemCaller: RecordedSystemLlmCaller | null;

  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly llmGateway: LlmGateway,
    private readonly eventBus: EventBus,
    options?: {
      queue?: MemoryUpdateQueueService;
      policy?: RuntimeMemoryPolicy;
      systemCaller?: RecordedSystemLlmCaller;
    },
  ) {
    this.systemCaller = options?.systemCaller ?? null;
    this.queue = options?.queue ?? new MemoryUpdateQueueService();
    this.policy = options?.policy ?? {
      enabled: true,
      injectionEnabled: true,
      maxFacts: 50,
      factConfidenceThreshold: 0.7,
    };
  }

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
    if (!this.policy.enabled) {
      return [];
    }

    const cappedLimit = Math.max(1, Math.min(limit, this.policy.maxFacts));

    // Search across all 3 scopes in parallel
    const [employeeMemories, teamMemories, companyMemories] = await Promise.all([
      this.memoryRepo.search(query, {
        scope: 'employee',
        ownerId: employeeId,
        companyId,
        limit: cappedLimit,
      }),
      this.memoryRepo.search(query, {
        scope: 'team',
        ownerId: companyId,
        companyId,
        limit: cappedLimit,
      }),
      this.memoryRepo.search(query, {
        scope: 'company',
        ownerId: companyId,
        companyId,
        limit: cappedLimit,
      }),
    ]);

    // Merge and deduplicate by memory_id
    const seen = new Set<string>();
    const all: MemoryEntryRow[] = [];
    for (const mem of [...employeeMemories, ...teamMemories, ...companyMemories]) {
      if (mem.confidence < this.policy.factConfidenceThreshold) {
        continue;
      }
      if (!seen.has(mem.memory_id)) {
        seen.add(mem.memory_id);
        all.push(mem);
      }
    }

    // Sort by relevance: importance * recency factor
    const now = Date.now();
    all.sort((a, b) => {
      return this.memoryScore(b, now) - this.memoryScore(a, now);
    });

    return all.slice(0, cappedLimit);
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
    confidence?: number;
    threadId: string;
    sourceTaskRunId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const content = this.normalizeContent(params.content);
    const dedupeKey = this.buildDedupeKey(content);
    const ownerId = params.scope === 'employee' ? params.employeeId : params.companyId;
    const confidence = this.clampConfidence(
      params.confidence ?? this.deriveConfidence(params.category, params.importance),
    );
    const metadataJson =
      params.metadata && Object.keys(params.metadata).length > 0
        ? JSON.stringify(params.metadata)
        : null;

    const existing = await this.memoryRepo.findByDedupeKey({
      companyId: params.companyId,
      scope: params.scope,
      ownerId,
      category: params.category,
      dedupeKey,
    });

    if (existing) {
      await this.memoryRepo.reinforce(existing.memory_id, {
        content,
        importance: params.importance,
        confidence,
        metadataJson,
        sourceThreadId: params.threadId,
        sourceTaskRunId: params.sourceTaskRunId ?? null,
      });
      return existing.memory_id;
    }

    const memoryId = generateId('mem');
    await this.memoryRepo.create({
      memory_id: memoryId,
      company_id: params.companyId,
      scope: params.scope,
      owner_id: ownerId,
      category: params.category,
      content,
      importance: params.importance,
      confidence,
      dedupe_key: dedupeKey,
      metadata_json: metadataJson,
      source_thread_id: params.threadId,
      source_task_run_id: params.sourceTaskRunId ?? null,
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

    // Prune least important memories when over limit. CRITICAL: prune within
    // the current scope only — team/company memories share `ownerId=companyId`
    // for the company scope, so a global sort would treat a low-importance
    // company memory as evictable when a high-importance team memory had
    // recently filled the team-scope budget (D/C1). Each scope keeps its own
    // 50-fact ceiling.
    const maxFacts = 50;
    const scopeMemories = (await this.memoryRepo.findByOwner(ownerId)).filter(
      (m) => m.scope === params.scope,
    );
    if (scopeMemories.length > maxFacts) {
      const sorted = [...scopeMemories].sort((a, b) => a.importance - b.importance);
      const toDelete = sorted.slice(0, scopeMemories.length - maxFacts);
      await Promise.all(toDelete.map((mem) => this.memoryRepo.delete(mem.memory_id)));
    }

    return memoryId;
  }

  /**
   * Delete a memory only when the caller owns it. Employee-scope memories are
   * owned by the employee; team/company-scope memories are owned by the
   * company. Cross-company access is always forbidden. Returns a typed outcome
   * instead of silently deleting so the `forget` tool can never erase another
   * employee's (or another company's) memory by guessing/replaying an id.
   */
  async forgetMemory(
    memoryId: string,
    scope: { employeeId: string; companyId: string },
  ): Promise<'deleted' | 'not-found-or-forbidden'> {
    const row = await this.memoryRepo.findById(memoryId);
    if (!row) return 'not-found-or-forbidden';
    if (row.company_id !== scope.companyId) return 'not-found-or-forbidden';
    const ownerMatches =
      row.scope === 'employee'
        ? row.owner_id === scope.employeeId
        : row.owner_id === scope.companyId;
    if (!ownerMatches) return 'not-found-or-forbidden';
    await this.memoryRepo.delete(memoryId);
    return 'deleted';
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
    if (opts?.skip || !this.policy.enabled) return;

    await this.queue.enqueue(`${companyId}:${employeeId}`, async () => {
      let rawResponse: string;
      try {
        const messages = pruneLlmMessages([
          { role: 'system', content: REFLECT_PROMPT + taskContent },
          { role: 'user', content: 'Extract memories from the task above.' },
        ]);
        const chatRequest: LlmRequest = {
          messages,
          model: 'default',
          temperature: 0.3,
          maxTokens: 1024,
          signal: opts?.signal,
        };
        const response = this.systemCaller
          ? await this.systemCaller.chat('memory_reflection', chatRequest)
          : await this.llmGateway.chat(chatRequest);
        rawResponse = response.content;
      } catch (error) {
        logger.error('reflectAndRemember failed', error, { employeeId });
        return;
      }

      const extracted = extractJsonFromLlm(rawResponse);
      if (!extracted) return;

      const parsed = ExtractedMemorySchema.safeParse(extracted);
      if (!parsed.success) return;

      for (const mem of parsed.data.memories) {
        try {
          await this.createMemory({
            employeeId,
            companyId,
            scope: mem.scope,
            category: mem.category,
            content: mem.content,
            importance: mem.importance,
            confidence: mem.confidence,
            threadId,
            metadata: { source: 'reflection' },
          });
        } catch (err) {
          logger.error('Failed to save memory', err, { employeeId });
        }
      }
    });
  }

  /** Recency factor: newer → higher score (exponential decay over 7 days) */
  private recencyFactor(referenceAt: string, now: number): number {
    const ageMs = now - new Date(referenceAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return Math.exp(-0.14 * ageDays);
  }

  private memoryScore(memory: MemoryEntryRow, now: number): number {
    const recency = this.recencyFactor(memory.last_reinforced_at, now);
    const reinforcementBonus = 1 + Math.min(memory.reinforcement_count - 1, 5) * 0.12;
    const accessBonus = 1 + Math.min(memory.access_count, 10) * 0.02;
    return memory.importance * memory.confidence * recency * reinforcementBonus * accessBonus;
  }

  private normalizeContent(content: string): string {
    return content.replace(/\s+/g, ' ').trim();
  }

  private buildDedupeKey(content: string): string {
    const normalized = content.normalize('NFKC').toLowerCase();
    const simplified = normalized
      .replace(/[.,:;/，。：；、]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return simplified || normalized.replace(/\s+/g, ' ').trim();
  }

  private deriveConfidence(category: string, importance: number): number {
    const categoryBase = category === 'preference' ? 0.8 : category === 'decision' ? 0.74 : 0.68;
    return this.clampConfidence(categoryBase + importance * 0.18);
  }

  private clampConfidence(confidence: number): number {
    return Math.min(0.98, Math.max(0.2, Number(confidence.toFixed(2))));
  }
}
