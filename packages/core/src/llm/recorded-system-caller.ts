/**
 * RecordedSystemLlmCaller — lightweight recorded wrapper for system services.
 *
 * System services (MemoryService, EventConsolidator, ConversationBudgetService,
 * UserMemoryService) need to call LLMs for background tasks but don't have a
 * full RuntimeContext. This caller provides the same audit semantics as
 * `recordedLlmCall()` without requiring the full runtime graph.
 *
 * All calls produce:
 * - llm_calls DB record
 * - llm.call.started / llm.call.completed / llm.usage.recorded events
 *
 * See CLAUDE.md — AI Runtime Policy, rule 4.
 */
import type { EventBus } from '../events/event-bus.js';
import { llmCallCompleted, llmCallStarted, llmUsageRecorded } from '../events/event-factories.js';
import type { LlmCallRepository } from '../runtime/repositories.js';
import { Logger } from '../services/logger.js';
import { generateId } from '../utils/generate-id.js';
import type { LlmGateway, LlmRequest, LlmResponse } from './gateway.js';

const logger = new Logger('system-llm');

export interface SystemLlmCallerDeps {
  llmGateway: LlmGateway;
  llmCalls: LlmCallRepository;
  eventBus: EventBus;
  companyId: string;
  threadId: string | null;
}

export class RecordedSystemLlmCaller {
  private readonly gateway: LlmGateway;
  private readonly llmCalls: LlmCallRepository;
  private readonly eventBus: EventBus;
  private readonly companyId: string;
  private readonly threadId: string | null;

  constructor(deps: SystemLlmCallerDeps) {
    this.gateway = deps.llmGateway;
    this.llmCalls = deps.llmCalls;
    this.eventBus = deps.eventBus;
    this.companyId = deps.companyId;
    this.threadId = deps.threadId;
  }

  /**
   * Perform a recorded LLM call with full audit trail.
   *
   * @param nodeName - Stable identifier for the system service making the call.
   *   Examples: 'memory_reflection', 'event_consolidation', 'conversation_budget', 'user_memory_extraction'
   * @param request - The LLM request to send.
   * @param provider - Provider name for audit (defaults to 'system').
   */
  async chat(nodeName: string, request: LlmRequest, provider = 'system'): Promise<LlmResponse> {
    const llmCallId = generateId('lc');
    const startedAt = Date.now();

    this.eventBus.emit(
      llmCallStarted(
        this.companyId,
        llmCallId,
        nodeName,
        provider,
        request.model,
        this.threadId ?? '',
      ),
    );

    try {
      const response = await this.gateway.chat(request);
      const latencyMs = Date.now() - startedAt;

      try {
        await this.llmCalls.create({
          llm_call_id: llmCallId,
          thread_id: this.threadId,
          task_run_id: null,
          node_name: nodeName,
          provider,
          model: request.model,
          input_tokens: response.usage.inputTokens,
          output_tokens: response.usage.outputTokens,
          cache_read_input_tokens: response.usage.cacheReadInputTokens ?? 0,
          cache_creation_input_tokens: response.usage.cacheCreationInputTokens ?? 0,
          usage_raw_json: JSON.stringify(response.usage),
          request_json: JSON.stringify({
            model: request.model,
            messages: request.messages,
            tools: request.tools ?? [],
          }),
          response_json: JSON.stringify(response),
          tool_calls_json: JSON.stringify(response.toolCalls),
          prompt_hash: null,
          tools_hash: null,
          response_hash: null,
          recording_mode: 'metadata',
          latency_ms: latencyMs,
          error_code: null,
          created_at: new Date().toISOString(),
        });
      } catch (dbError) {
        logger.error('Failed to record system LLM call', dbError, { llmCallId, nodeName });
      }

      this.eventBus.emit(
        llmCallCompleted(
          this.companyId,
          llmCallId,
          nodeName,
          latencyMs,
          response.usage.inputTokens,
          response.usage.outputTokens,
          response.usage.cacheReadInputTokens ?? 0,
          response.usage.cacheCreationInputTokens ?? 0,
        ),
      );
      this.eventBus.emit(
        llmUsageRecorded(
          this.companyId,
          llmCallId,
          this.threadId ?? '',
          null,
          provider,
          request.model,
          nodeName,
          response.usage.inputTokens,
          response.usage.outputTokens,
          latencyMs,
          response.usage.cacheReadInputTokens ?? 0,
          response.usage.cacheCreationInputTokens ?? 0,
        ),
      );

      return response;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const errorCode = error instanceof Error ? error.message : 'unknown';

      try {
        await this.llmCalls.create({
          llm_call_id: llmCallId,
          thread_id: this.threadId,
          task_run_id: null,
          node_name: nodeName,
          provider,
          model: request.model,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          usage_raw_json: null,
          request_json: null,
          response_json: null,
          tool_calls_json: null,
          prompt_hash: null,
          tools_hash: null,
          response_hash: null,
          recording_mode: 'metadata',
          latency_ms: latencyMs,
          error_code: errorCode,
          created_at: new Date().toISOString(),
        });
      } catch (dbError) {
        logger.error('Failed to record system LLM error', dbError, { llmCallId, nodeName });
      }

      throw error;
    }
  }
}
