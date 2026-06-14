/**
 * RecordedSystemLlmCaller — lightweight recorded wrapper for system services.
 *
 * System services (MemoryService, ConversationBudgetService) need to call LLMs
 * for background tasks but don't have a full RuntimeContext.
 * This caller provides the same audit semantics as
 * `recordedLlmCall()` without requiring the full runtime graph.
 *
 * All calls produce:
 * - llm_calls DB record
 * - llm.call.started / llm.call.completed / llm.usage.recorded events
 *
 * See CLAUDE.md — AI Runtime Policy, rule 4.
 */
import type { EventBus } from '../events/event-bus.js';
import { llmCallStarted } from '../events/event-factories.js';
import type { LlmCallRepository } from '../runtime/repositories.js';
import { Logger } from '../services/logger.js';
import { generateId } from '../utils/generate-id.js';
import type { LlmGateway, LlmRequest, LlmResponse } from './gateway.js';
import {
  EMPTY_LLM_CALL_REPLAY,
  EMPTY_LLM_CALL_USAGE,
  buildLlmCallRow,
  emitLlmCallCompletedAndUsage,
} from './llm-call-record.js';

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

      // recording_mode is 'metadata' for system calls (no RuntimeContext /
      // runtime policy to opt into full replay capture), so the prompt/response/
      // tool-call bodies stay null (EMPTY_LLM_CALL_REPLAY) to honor the
      // recorded-call contract — only counts and usage are persisted.
      try {
        await this.llmCalls.create(
          buildLlmCallRow({
            llmCallId,
            threadId: this.threadId,
            taskRunId: null,
            nodeName,
            provider,
            model: request.model,
            usage: {
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              cacheReadInputTokens: response.usage.cacheReadInputTokens ?? 0,
              cacheCreationInputTokens: response.usage.cacheCreationInputTokens ?? 0,
              usageRawJson: JSON.stringify(response.usage),
            },
            replay: EMPTY_LLM_CALL_REPLAY,
            recordingMode: 'metadata',
            latencyMs,
            errorCode: null,
            createdAt: new Date().toISOString(),
          }),
        );
      } catch (dbError) {
        logger.error('Failed to record system LLM call', dbError, { llmCallId, nodeName });
      }

      emitLlmCallCompletedAndUsage(this.eventBus, {
        companyId: this.companyId,
        llmCallId,
        nodeName,
        threadId: this.threadId ?? '',
        taskRunId: null,
        provider,
        model: request.model,
        latencyMs,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadInputTokens: response.usage.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: response.usage.cacheCreationInputTokens ?? 0,
      });

      return response;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const errorCode = error instanceof Error ? error.message : 'unknown';

      try {
        await this.llmCalls.create(
          buildLlmCallRow({
            llmCallId,
            threadId: this.threadId,
            taskRunId: null,
            nodeName,
            provider,
            model: request.model,
            usage: EMPTY_LLM_CALL_USAGE,
            replay: EMPTY_LLM_CALL_REPLAY,
            recordingMode: 'metadata',
            latencyMs,
            errorCode,
            createdAt: new Date().toISOString(),
          }),
        );
      } catch (dbError) {
        logger.error('Failed to record system LLM error', dbError, { llmCallId, nodeName });
      }

      throw error;
    }
  }
}
