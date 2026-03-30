import type { EventBus } from '../events/event-bus.js';
import { memoryCreated } from '../events/event-factories.js';
import type { LlmGateway, LlmRequest } from '../llm/gateway.js';
import { pruneLlmMessages } from '../llm/prune-messages.js';
import type { RecordedSystemLlmCaller } from '../llm/recorded-system-caller.js';
import type { AgentEventRepository, MemoryRepository } from '../runtime/repositories.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { Logger } from './logger.js';

const logger = new Logger('event-consolidator');

const CONSOLIDATE_PROMPT = `You are a knowledge extraction AI. Given a sequence of agent decision events from a project execution, produce a concise experience summary.

Focus on:
- What worked well (successful strategies, good decisions)
- What went wrong (errors, replans, stuck tasks)
- Patterns worth remembering (task types that needed specific approaches)
- Timing insights (steps that took long, steps that were quick)

Rules:
- Write 1-3 sentences, self-contained and useful for future project planning
- Do NOT include IDs, timestamps, or raw JSON
- Write as actionable advice for a PM planning a similar project

Respond ONLY with JSON:
{ "summary": "...", "importance": 0.0-1.0 }

Events:
`;

/**
 * EventConsolidator — compresses raw agent_events into experience summaries.
 *
 * Reads recent events for a project/thread, asks LLM to extract actionable
 * insights, and stores them as company-scope memory entries via MemoryService.
 *
 * This closes the "write-only" loop: events → experience → PM reads → better plans.
 */
export class EventConsolidator {
  private readonly systemCaller: RecordedSystemLlmCaller | null;

  constructor(
    private readonly agentEvents: AgentEventRepository,
    private readonly memoryRepo: MemoryRepository,
    private readonly llmGateway: LlmGateway,
    private readonly eventBus: EventBus,
    systemCaller?: RecordedSystemLlmCaller,
  ) {
    this.systemCaller = systemCaller ?? null;
  }

  /**
   * Consolidate recent events for a thread into an experience summary.
   * Called after a plan completes (from boss_summary or heartbeat).
   *
   * @returns The memory_id of the created summary, or null if nothing worth consolidating.
   */
  async consolidate(opts: {
    threadId: string;
    companyId: string;
    projectName?: string;
    limit?: number;
  }): Promise<string | null> {
    const events = await this.agentEvents.findByThread(opts.threadId, {
      limit: opts.limit ?? 30,
    });

    if (events.length < 3) {
      // Too few events to consolidate — not worth an LLM call
      return null;
    }

    // Format events for LLM
    const eventsText = events
      .reverse() // chronological order
      .map((e) => `[${e.agent_name}] ${e.event_type}: ${e.payload_json.slice(0, 300)}`)
      .join('\n');

    const projectLabel = opts.projectName ? ` (project: ${opts.projectName})` : '';

    let rawResponse: string;
    try {
      const messages = pruneLlmMessages([
        { role: 'system', content: CONSOLIDATE_PROMPT + eventsText },
        { role: 'user', content: `Summarize the execution experience${projectLabel}.` },
      ]);
      const chatRequest: LlmRequest = {
        messages,
        model: 'default',
        temperature: 0.3,
        maxTokens: 512,
      };
      const response = this.systemCaller
        ? await this.systemCaller.chat('event_consolidation', chatRequest)
        : await this.llmGateway.chat(chatRequest);
      rawResponse = response.content;
    } catch (err) {
      logger.error('Consolidation LLM call failed', err);
      return null;
    }

    const parsed = extractJsonFromLlm(rawResponse) as Record<string, unknown> | null;
    if (!parsed || typeof parsed.summary !== 'string') {
      return null;
    }

    const importance =
      typeof parsed.importance === 'number' ? Math.max(0, Math.min(1, parsed.importance)) : 0.6;

    // Store as company-scope experience memory
    const memoryId = generateId('mem');
    await this.memoryRepo.create({
      memory_id: memoryId,
      company_id: opts.companyId,
      scope: 'company',
      owner_id: opts.companyId,
      category: 'experience',
      content: parsed.summary,
      importance,
      source_thread_id: opts.threadId,
    });

    this.eventBus.emit(
      memoryCreated(
        opts.companyId,
        memoryId,
        'consolidator',
        'company',
        'experience',
        (parsed.summary as string).slice(0, 100),
        opts.threadId,
      ),
    );

    return memoryId;
  }
}
