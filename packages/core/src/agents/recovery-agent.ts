import type { RunnableConfig } from '@langchain/core/runnables';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { getConfigSignal } from '../utils/get-signal.js';

/** Structured error parsed from interruptReason */
export interface StructuredError {
  errorCode: string;
  message: string;
  recoverable: boolean;
  nodeName: string;
  employeeId?: string;
  taskRunId?: string;
  provider?: string;
  model?: string;
}

export type FixStrategy =
  | 'retry_with_backoff'
  | 'switch_model'
  | 'skip_and_continue'
  | 'replan_step'
  | 'escalate';

export interface RecoveryDecision {
  strategy: FixStrategy;
  cause: string;
  confidence: number;
  knowledgeId?: string; // if matched from existing knowledge
}

const RECOVERY_PROMPT = `You are a Recovery Agent. An error occurred during project execution.

Error: {errorCode} — {errorMessage}
Node: {nodeName}
Recent events: {recentEvents}
Similar past errors: {pastFixes}

Decide:
1. Is this a known pattern? → Apply the matching fix
2. Is this a new pattern? → Propose a fix strategy from: retry_with_backoff, switch_model, skip_and_continue, replan_step, escalate
3. What's the root cause? (for learning)

Respond with JSON only:
{ "fix_strategy": "...", "cause": "...", "confidence": 0.0-1.0 }
If confidence < 0.5, set fix_strategy = "escalate".`;

/**
 * Attempt to diagnose and recover from an error using the knowledge base.
 * Returns null if no recovery is possible (caller should escalate).
 */
export async function diagnoseAndRecover(
  runtimeCtx: RuntimeContext,
  config: RunnableConfig,
  error: StructuredError,
  threadId: string,
  _projectId: string | null,
): Promise<RecoveryDecision | null> {
  const { repos, modelResolver } = runtimeCtx;

  // 1. Check knowledge base for known fix
  if (repos.recoveryKnowledge) {
    const bestFix = await repos.recoveryKnowledge.findBestFix(error.errorCode);
    if (bestFix) {
      const totalAttempts = bestFix.success_count + bestFix.failure_count;
      const successRate = totalAttempts > 0 ? bestFix.success_count / totalAttempts : 0.5;

      // Only use if success rate is above threshold (30%)
      if (successRate >= 0.3) {
        return {
          strategy: bestFix.fix_strategy as FixStrategy,
          cause: bestFix.cause,
          confidence: successRate,
          knowledgeId: bestFix.knowledge_id,
        };
      }
    }
  }

  // 2. If no known fix or low confidence, consult LLM
  if (!error.recoverable) {
    return { strategy: 'escalate', cause: 'non_recoverable_error', confidence: 1.0 };
  }

  // Gather context for LLM diagnosis
  let recentEventsText = '(no event history)';
  if (repos.agentEvents) {
    const recent = await repos.agentEvents.findRecent(threadId, 10);
    if (recent.length > 0) {
      recentEventsText = recent
        .map((e) => `[${e.agent_name}] ${e.event_type}: ${e.payload_json.slice(0, 200)}`)
        .join('\n');
    }
  }

  let pastFixesText = '(no past fixes)';
  if (repos.recoveryKnowledge) {
    const pastFixes = await repos.recoveryKnowledge.findBySymptom(error.errorCode);
    if (pastFixes.length > 0) {
      pastFixesText = pastFixes
        .map(
          (f) =>
            `symptom=${f.symptom} cause=${f.cause} fix=${f.fix_strategy} success=${f.success_count}/${f.success_count + f.failure_count}`,
        )
        .join('\n');
    }
  }

  const prompt = RECOVERY_PROMPT.replace('{errorCode}', error.errorCode)
    .replace('{errorMessage}', error.message)
    .replace('{nodeName}', error.nodeName)
    .replace('{recentEvents}', recentEventsText)
    .replace('{pastFixes}', pastFixesText);

  try {
    const resolved = modelResolver.resolve(null, 'boss'); // Use boss model for recovery (cheapest smart model)
    const llmResponse = await recordedLlmCall(
      runtimeCtx,
      {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `Diagnose and suggest recovery for: ${error.errorCode}` },
        ],
        model: resolved.model,
        temperature: 0.2, // Low temperature for deterministic diagnosis
        maxTokens: 500,
        signal: getConfigSignal(config),
      },
      { nodeName: 'recovery', provider: resolved.provider, model: resolved.model },
    );

    const parsed = extractJsonFromLlm(llmResponse.content) as Record<string, unknown> | null;
    if (parsed && typeof parsed.fix_strategy === 'string' && typeof parsed.cause === 'string') {
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
      const strategy = confidence < 0.5 ? 'escalate' : (parsed.fix_strategy as FixStrategy);

      return { strategy, cause: parsed.cause as string, confidence };
    }
  } catch {
    // LLM diagnosis failed — escalate
  }

  return null;
}

/**
 * Record the outcome of a recovery attempt into the knowledge base.
 */
export async function recordRecoveryOutcome(
  runtimeCtx: RuntimeContext,
  symptom: string,
  cause: string,
  strategy: FixStrategy,
  success: boolean,
  knowledgeId?: string,
): Promise<void> {
  const { repos } = runtimeCtx;
  if (!repos.recoveryKnowledge) return;

  if (knowledgeId) {
    // Update existing knowledge
    if (success) {
      await repos.recoveryKnowledge.incrementSuccess(knowledgeId);
    } else {
      await repos.recoveryKnowledge.incrementFailure(knowledgeId);
    }
  } else {
    // Create new knowledge entry
    await repos.recoveryKnowledge.upsert({
      knowledge_id: generateId('rk'),
      symptom,
      cause,
      fix_strategy: strategy,
      fix_config: null,
    });
    // Find the newly created entry and update its count
    const entries = await repos.recoveryKnowledge.findBySymptom(symptom);
    const entry = entries.find((e) => e.cause === cause);
    if (entry) {
      if (success) {
        await repos.recoveryKnowledge.incrementSuccess(entry.knowledge_id);
      } else {
        await repos.recoveryKnowledge.incrementFailure(entry.knowledge_id);
      }
    }
  }
}
