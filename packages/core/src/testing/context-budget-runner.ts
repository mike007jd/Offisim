import { forkSubContext } from '../a2a/fork-sub-context.js';
import type { LlmMessage } from '../llm/gateway.js';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { ConversationBudgetService } from '../services/conversation-budget-service.js';
import { microCompactMessages } from '../services/conversation-budget/micro-compact.js';
import type { DeterministicScenario } from './scenario-runner.js';
import { runDeterministicScenario } from './scenario-runner.js';

export interface ContextBudgetCaseReport {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly contextInputTokensBefore: number;
  readonly contextInputTokensAfter: number;
  readonly compactedMessageCount: number;
  readonly keptTailMessages: number;
  readonly lostFactCount: number;
}

export interface ContextBudgetReport {
  readonly suite: 'context';
  readonly cases: readonly ContextBudgetCaseReport[];
  readonly passed: number;
  readonly failed: number;
}

export async function runContextBudgetHarness(
  scenarios: readonly DeterministicScenario[],
): Promise<ContextBudgetReport> {
  const cases: ContextBudgetCaseReport[] = [];
  for (const scenario of scenarios) {
    if (isMicroCompactContextScenario(scenario)) {
      cases.push(runMicroCompactContextCase(scenario));
      continue;
    }
    if (isContextBudgetPolicyScenario(scenario)) {
      cases.push(await runContextBudgetPolicyCase(scenario));
      continue;
    }
    if (isPromptTooLongRecoveryScenario(scenario)) {
      cases.push(await runPromptTooLongRecoveryCase(scenario));
      continue;
    }
    if (isForkSubcontextIsolationScenario(scenario)) {
      cases.push(await runForkSubcontextIsolationCase(scenario));
      continue;
    }

    const before = estimateScenarioInputTokens(scenario);
    const report = await runDeterministicScenario(scenario);
    const after = estimateTraceTokens(report.trace.finalState);
    const pendingInteractions = Array.isArray(report.trace.db.activeInteractions)
      ? report.trace.db.activeInteractions.length
      : 0;
    cases.push({
      scenarioId: scenario.id,
      passed: report.passed && pendingInteractions === 0,
      contextInputTokensBefore: before,
      contextInputTokensAfter: after,
      compactedMessageCount: countCompactedMarkers(report.trace.finalState),
      keptTailMessages: countRetainedTailMessages(report.trace.finalState),
      lostFactCount: 0,
    });
  }
  return {
    suite: 'context',
    cases,
    passed: cases.filter((testCase) => testCase.passed).length,
    failed: cases.filter((testCase) => !testCase.passed).length,
  };
}

interface MicroCompactContextScenario {
  readonly id: string;
  readonly fixture: {
    readonly toolResultCount: number;
    readonly toolResultBytes: number;
    readonly maxToolResultBytes: number;
    readonly snippetBytes: number;
    readonly preserveLastN: number;
    readonly maxFinalNonSystemBytes: number;
  };
}

interface ContextBudgetPolicyScenario {
  readonly id: string;
  readonly fixture: {
    readonly contextBudgetPolicy: true;
    readonly nonSystemMessages: number;
    readonly toolResultEveryNMessages: number;
    readonly toolResultBytes: number;
    readonly tailNonSystemMessages: number;
    readonly toolResultKeepRecent: number;
    readonly toolResultMaxContentChars: number;
    readonly microMaxToolResultBytes: number;
    readonly microSnippetBytes: number;
    readonly microPreserveLastN: number;
  };
}

interface PromptTooLongRecoveryScenario {
  readonly id: string;
  readonly fixture: {
    readonly promptTooLongRecovery: true;
    readonly nonSystemMessages: number;
    readonly messageBytes: number;
    readonly tailNonSystemMessages: number;
    readonly promptTooLongThresholdTokens: number;
    readonly maxRecoveredTokens: number;
  };
}

interface ForkSubcontextIsolationScenario {
  readonly id: string;
  readonly fixture: {
    readonly forkSubcontextIsolation: true;
    readonly parentObjective: string;
    readonly childSecret: string;
  };
}

function isMicroCompactContextScenario(
  scenario: DeterministicScenario,
): scenario is DeterministicScenario & MicroCompactContextScenario {
  const fixture = (scenario as { fixture?: unknown }).fixture;
  if (!fixture || typeof fixture !== 'object') return false;
  const record = fixture as Record<string, unknown>;
  return (
    typeof record.toolResultCount === 'number' &&
    typeof record.toolResultBytes === 'number' &&
    typeof record.maxToolResultBytes === 'number' &&
    typeof record.snippetBytes === 'number' &&
    typeof record.preserveLastN === 'number' &&
    typeof record.maxFinalNonSystemBytes === 'number'
  );
}

function isContextBudgetPolicyScenario(
  scenario: DeterministicScenario,
): scenario is DeterministicScenario & ContextBudgetPolicyScenario {
  const fixture = (scenario as { fixture?: unknown }).fixture;
  if (!fixture || typeof fixture !== 'object') return false;
  const record = fixture as Record<string, unknown>;
  return record.contextBudgetPolicy === true;
}

function isPromptTooLongRecoveryScenario(
  scenario: DeterministicScenario,
): scenario is DeterministicScenario & PromptTooLongRecoveryScenario {
  const fixture = (scenario as { fixture?: unknown }).fixture;
  if (!fixture || typeof fixture !== 'object') return false;
  return (fixture as Record<string, unknown>).promptTooLongRecovery === true;
}

function isForkSubcontextIsolationScenario(
  scenario: DeterministicScenario,
): scenario is DeterministicScenario & ForkSubcontextIsolationScenario {
  const fixture = (scenario as { fixture?: unknown }).fixture;
  if (!fixture || typeof fixture !== 'object') return false;
  return (fixture as Record<string, unknown>).forkSubcontextIsolation === true;
}

function runMicroCompactContextCase(
  scenario: MicroCompactContextScenario,
): ContextBudgetCaseReport {
  const messages = Array.from({ length: scenario.fixture.toolResultCount }, (_, index) => ({
    role: 'tool' as const,
    content: `${String(index).repeat(scenario.fixture.toolResultBytes)}`,
    toolCallId: `tool-${index}`,
  }));
  const before = estimateMessagesTokens(messages);
  const compacted = microCompactMessages(messages, {
    maxToolResultBytes: scenario.fixture.maxToolResultBytes,
    snippetBytes: scenario.fixture.snippetBytes,
    preserveLastN: scenario.fixture.preserveLastN,
  });
  const after = estimateMessagesTokens(compacted.messages);
  const joined = compacted.messages.map((message) => message.content).join('\n');
  const retainedTailMessages = countRetainedLargeToolMessages(
    compacted.messages,
    scenario.fixture.maxToolResultBytes,
  );
  const expectedCompacted = Math.max(
    0,
    scenario.fixture.toolResultCount - scenario.fixture.preserveLastN,
  );
  const lostFactCount = countLostMicroCompactFacts(
    compacted.messages,
    scenario.fixture.toolResultCount,
  );
  const finalBytes = new TextEncoder().encode(joined).byteLength;

  return {
    scenarioId: scenario.id,
    passed:
      compacted.compacted === expectedCompacted &&
      retainedTailMessages === scenario.fixture.preserveLastN &&
      lostFactCount === 0 &&
      finalBytes <= scenario.fixture.maxFinalNonSystemBytes &&
      after < before,
    contextInputTokensBefore: before,
    contextInputTokensAfter: after,
    compactedMessageCount: compacted.compacted,
    keptTailMessages: retainedTailMessages,
    lostFactCount,
  };
}

async function runContextBudgetPolicyCase(
  scenario: ContextBudgetPolicyScenario,
): Promise<ContextBudgetCaseReport> {
  const repos = createMemoryRepositories();
  const companyId = `company-${scenario.id}`;
  const threadId = `thread-${scenario.id}`;
  await repos.threads.create({
    thread_id: threadId,
    company_id: companyId,
    entry_mode: 'boss_chat',
    root_task_id: null,
    status: 'running',
    project_id: null,
  });
  const service = new ConversationBudgetService({
    maxNonSystemMessages: scenario.fixture.tailNonSystemMessages,
    tailNonSystemMessages: scenario.fixture.tailNonSystemMessages,
    synopsisTriggerMessages: scenario.fixture.nonSystemMessages + 100,
    fullCompactTriggerMessages: scenario.fixture.nonSystemMessages + 100,
    fullCompactTriggerTokens: 1_000_000,
    toolResultKeepRecent: scenario.fixture.toolResultKeepRecent,
    toolResultMaxContentChars: scenario.fixture.toolResultMaxContentChars,
    microMaxToolResultBytes: scenario.fixture.microMaxToolResultBytes,
    microSnippetBytes: scenario.fixture.microSnippetBytes,
    microPreserveLastN: scenario.fixture.microPreserveLastN,
  });
  const requestMessages = buildPolicyFixtureMessages(scenario.fixture);
  const before = estimateMessagesTokens(requestMessages);
  const prepared = await service.prepareRequest(
    {
      repos,
      companyId,
      threadId,
      runtimePolicy: {
        summarization: {
          enabled: true,
          triggerTokens: 1_000_000,
          keepRecentMessages: scenario.fixture.tailNonSystemMessages,
        },
      },
    } as unknown as RuntimeContext,
    {
      messages: requestMessages,
      model: 'fake-model',
      temperature: 0,
      maxTokens: 128,
    },
  );
  const after = estimateMessagesTokens(prepared.messages);
  const nonSystemMessages = prepared.messages.filter((message) => message.role !== 'system');
  const compactedMessageCount = countCompactedMarkers(prepared.messages);
  const retainedLargeToolMessages = countRetainedLargeToolMessages(
    prepared.messages,
    scenario.fixture.microMaxToolResultBytes,
  );
  const overCompactedRecentToolMessages =
    retainedLargeToolMessages !== scenario.fixture.toolResultKeepRecent;

  return {
    scenarioId: scenario.id,
    passed:
      nonSystemMessages.length <= scenario.fixture.tailNonSystemMessages &&
      compactedMessageCount > 0 &&
      !overCompactedRecentToolMessages &&
      after < before,
    contextInputTokensBefore: before,
    contextInputTokensAfter: after,
    compactedMessageCount,
    keptTailMessages: retainedLargeToolMessages,
    lostFactCount: overCompactedRecentToolMessages ? 1 : 0,
  };
}

function buildPolicyFixtureMessages(
  fixture: ContextBudgetPolicyScenario['fixture'],
): readonly LlmMessage[] {
  const messages: LlmMessage[] = [
    { role: 'system', content: 'System policy must stay at the front.' },
  ];
  for (let index = 1; index <= fixture.nonSystemMessages; index += 1) {
    if (index % fixture.toolResultEveryNMessages === 0) {
      messages.push({
        role: 'tool',
        toolCallId: `tool-${index}`,
        content: `tool-${index}:${'x'.repeat(fixture.toolResultBytes)}`,
      });
    } else {
      messages.push({
        role: index % 2 === 0 ? 'assistant' : 'user',
        content: `message-${index}`,
      });
    }
  }
  return messages;
}

async function runPromptTooLongRecoveryCase(
  scenario: PromptTooLongRecoveryScenario,
): Promise<ContextBudgetCaseReport> {
  const repos = createMemoryRepositories();
  const companyId = `company-${scenario.id}`;
  const threadId = `thread-${scenario.id}`;
  await repos.threads.create({
    thread_id: threadId,
    company_id: companyId,
    entry_mode: 'boss_chat',
    root_task_id: null,
    status: 'running',
    project_id: null,
  });
  const requestMessages = buildPromptTooLongMessages(scenario.fixture);
  const before = estimateMessagesTokens(requestMessages);
  const service = new ConversationBudgetService({
    maxNonSystemMessages: scenario.fixture.tailNonSystemMessages,
    tailNonSystemMessages: scenario.fixture.tailNonSystemMessages,
    synopsisTriggerMessages: scenario.fixture.nonSystemMessages + 100,
    fullCompactTriggerMessages: scenario.fixture.nonSystemMessages + 100,
    fullCompactTriggerTokens: 1_000_000,
  });
  const prepared = await service.prepareRequest(
    {
      repos,
      companyId,
      threadId,
      runtimePolicy: {
        summarization: {
          enabled: true,
          triggerTokens: 1_000_000,
          keepRecentMessages: scenario.fixture.tailNonSystemMessages,
        },
      },
    } as unknown as RuntimeContext,
    {
      messages: requestMessages,
      model: 'fake-model',
      temperature: 0,
      maxTokens: 128,
    },
  );
  const after = estimateMessagesTokens(prepared.messages);
  const nonSystemMessages = prepared.messages.filter((message) => message.role !== 'system');

  return {
    scenarioId: scenario.id,
    passed:
      before > scenario.fixture.promptTooLongThresholdTokens &&
      after <= scenario.fixture.maxRecoveredTokens &&
      nonSystemMessages.length <= scenario.fixture.tailNonSystemMessages,
    contextInputTokensBefore: before,
    contextInputTokensAfter: after,
    compactedMessageCount: countCompactedMarkers(prepared.messages),
    keptTailMessages: nonSystemMessages.length,
    lostFactCount: 0,
  };
}

function buildPromptTooLongMessages(
  fixture: PromptTooLongRecoveryScenario['fixture'],
): readonly LlmMessage[] {
  const messages: LlmMessage[] = [{ role: 'system', content: 'Keep the request bounded.' }];
  for (let index = 1; index <= fixture.nonSystemMessages; index += 1) {
    messages.push({
      role: index % 2 === 0 ? 'assistant' : 'user',
      content: `long-message-${index}:${'p'.repeat(fixture.messageBytes)}`,
    });
  }
  return messages;
}

async function runForkSubcontextIsolationCase(
  scenario: ForkSubcontextIsolationScenario,
): Promise<ContextBudgetCaseReport> {
  const parentMessages: LlmMessage[] = [
    { role: 'user', content: scenario.fixture.parentObjective },
  ];
  const result = await forkSubContext({
    subTask: `Investigate privately: ${scenario.fixture.childSecret}`,
    runChild: async (childMessages) => {
      const transcript: LlmMessage[] = [
        ...childMessages,
        { role: 'assistant', content: `private transcript ${scenario.fixture.childSecret}` },
      ];
      return {
        summary: 'child investigation complete',
        transcript,
        childTokensUsed: estimateMessagesTokens(transcript),
      };
    },
  });
  const serializedResult = JSON.stringify(result);
  const parentSerialized = JSON.stringify(parentMessages);
  const leakedSecret =
    serializedResult.includes(scenario.fixture.childSecret) ||
    parentSerialized.includes(scenario.fixture.childSecret);

  return {
    scenarioId: scenario.id,
    passed:
      result.summary === 'child investigation complete' &&
      typeof result.childTokensUsed === 'number' &&
      !leakedSecret,
    contextInputTokensBefore: estimateMessagesTokens(parentMessages),
    contextInputTokensAfter: estimateTokens(serializedResult),
    compactedMessageCount: 0,
    keptTailMessages: parentMessages.length,
    lostFactCount: leakedSecret ? 1 : 0,
  };
}

function estimateScenarioInputTokens(scenario: DeterministicScenario): number {
  return (
    estimateTokens(JSON.stringify(scenario.initialState ?? null)) + estimateTokens(scenario.id)
  );
}

function estimateTraceTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value ?? null));
}

function estimateMessagesTokens(messages: readonly LlmMessage[]): number {
  return estimateTokens(messages.map((message) => message.content).join('\n'));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countCompactedMarkers(value: unknown): number {
  return (
    JSON.stringify(value ?? '').match(
      /\[(?:microcompacted|compacted|tool result compacted)[^\]]+\]/gu,
    ) ?? []
  ).length;
}

function countRetainedTailMessages(value: unknown): number {
  const state = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const metrics = state.metrics && typeof state.metrics === 'object' ? state.metrics : null;
  const passes = metrics ? (metrics as { microCompactPasses?: unknown }).microCompactPasses : null;
  return typeof passes === 'number' && passes > 0 ? 1 : 0;
}

function countRetainedLargeToolMessages(
  messages: readonly LlmMessage[],
  maxToolResultBytes: number,
): number {
  const encoder = new TextEncoder();
  return messages.filter(
    (message) =>
      message.role === 'tool' &&
      !message.content.includes('[microcompacted ') &&
      encoder.encode(message.content).byteLength > maxToolResultBytes,
  ).length;
}

function countLostMicroCompactFacts(
  messages: readonly LlmMessage[],
  expectedToolResultCount: number,
): number {
  let lost = 0;
  for (let index = 0; index < expectedToolResultCount; index += 1) {
    const expectedHead = String(index).repeat(8);
    const expectedTail = String(index).repeat(8);
    const found = messages.some(
      (message) => message.content.includes(expectedHead) && message.content.includes(expectedTail),
    );
    if (!found) lost += 1;
  }
  return lost;
}
