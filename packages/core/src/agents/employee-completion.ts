import { AIMessage } from '@langchain/core/messages';
import { TASK_ASSIGNMENT_REROUTED } from '@offisim/shared-types';
import {
  deliverableCreated,
  employeeStateChanged,
  taskAssignmentChanged,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { CitationRef, OffisimGraphState } from '../graph/state.js';
import type { LlmResponse } from '../llm/gateway.js';
import { type VerifyOutcome, verifyCompletion } from '../runtime/completion-verifier.js';
import type { TaskCompletionVerifyingPayload } from '../runtime/hook-registry.js';
import { type McpAuditRow, employeeBrandFields } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { CitationEntry } from '../services/library-service.js';
import { Logger } from '../services/logger.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import {
  buildEmployeeDeliverableTitle,
  materializeFileDeliverableIfNeeded,
} from './employee-deliverables.js';
import type { MaterializedEmployeeDeliverable } from './employee-deliverables.js';
import { TASK_TYPE_HANDOFF_CONTINUATION } from './employee-node-constants.js';
import type { PreflightResult } from './employee-preflight.js';
import {
  detectTaskToolIntent,
  evidenceToolsForIntent,
  unionTaskToolIntents,
} from './task-tool-intent.js';

const logger = new Logger('employee-completion');

const ROUTING_EVENT_EVIDENCE_RE =
  /\b(reroute|rerouted|rerouting|rebind|rebinding|employee-not-found|employee-disabled|requires-local-tools|missing employee|missing employee id)\b/iu;

const FULL_USER_INTENT_RE = /\bFull user intent:/iu;
const ARTIFACT_WRITE_TASK_RE =
  /\b(0[1-5]_(source_copy|analysis|presentation|infographic|evidence)|pdf|pptx?|presentation|html|infographic|manifest|copy|folder structure|directory structure)\b/iu;
const BASH_WRITE_COMMAND_RE =
  /(^|[;&|()\s])(mkdir|cp|rsync|ditto|install|touch|tee|cat\s*>\s*|printf\b[^|;&]*>\s*|echo\b[^|;&]*>\s*|python\d?\b|node\b|pandoc|libreoffice|osascript)\b|>>?/iu;
const LEGACY_TOOL_FAILURE_RE = /^(Tool execution failed:|Error (reading|writing) file:)/iu;
const BASH_TIMEOUT_RE = /\[TIMEOUT: command exceeded time limit\]|Command timed out/iu;
const PATH_CANDIDATE_RE =
  /(?:^|[\s("'`])((?:\/[^\s"'`]+|(?:\.{1,2}\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?))(?=$|[\s)"'`,.;:，。；：、])/gu;
const CONCRETE_PATH_DIR_RE =
  /(?:^|\/)(deliverables|0[1-5]_(source_copy|analysis|presentation|infographic|evidence)|source_project)(?:\/|$)/iu;
const CONCRETE_PATH_EXTENSION_RE = /\.[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const PSEUDO_ARTIFACT_PATH_RE =
  /^(pdf|pptx?|presentation|report|html|infographic|manifest)\/(pdf|pptx?|presentation|report|html|infographic|manifest|path)$/iu;
const DEPENDENCY_CONSTRAINT_CONTEXT_RE =
  /\b(do not|don't|without|no new packages|not rely|avoid|forbid|forbidden|must not|cannot)\b|禁止|不要|不能|不得|别用|不使用|不依赖|无需新增|不要新增|不要安装/u;
const INSTALL_COMMAND_RE =
  /(^|[;&|()\s])((python\d?|python)\s+-m\s+pip\s+install|pip\d?\s+install|uv\s+add|npm\s+(install|i)\b|pnpm\s+(add|install)\b|yarn\s+(add|install)\b|bun\s+(add|install)\b)/iu;
const REPORTLAB_USAGE_RE = /\breportlab\b/iu;
const PYTHON_PPTX_USAGE_RE = /\bpython-pptx\b|\bfrom\s+pptx\b|\bimport\s+pptx\b/iu;

function taskSpecificDescription(taskDescription: string): string {
  return taskDescription.split(FULL_USER_INTENT_RE)[0]?.trim() || taskDescription;
}

function fullUserIntentDescription(taskDescription: string): string {
  const match = FULL_USER_INTENT_RE.exec(taskDescription);
  if (!match) return '';
  return taskDescription.slice(match.index + match[0].length).trim();
}

export function requiresConcreteWriteEvidence(taskDescription: string): boolean {
  const specificDescription = taskSpecificDescription(taskDescription);
  if (!ARTIFACT_WRITE_TASK_RE.test(specificDescription)) return false;
  return detectTaskToolIntent(specificDescription).needsWrite;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function pickStringField(record: Record<string, unknown> | null, field: string): string {
  const value = record?.[field];
  return typeof value === 'string' ? value : '';
}

function parseAuditResultText(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  } catch {
    return value;
  }
}

function resultTextIndicatesFailure(text: string): boolean {
  if (LEGACY_TOOL_FAILURE_RE.test(text) || BASH_TIMEOUT_RE.test(text)) return true;
  const exitCodeMatch = /\[Exit code:\s*(-?\d+)\]/iu.exec(text);
  return !!exitCodeMatch && Number(exitCodeMatch[1]) !== 0;
}

function auditRowSucceeded(row: Pick<McpAuditRow, 'error' | 'result_json'>): boolean {
  if (row.error) return false;
  return !resultTextIndicatesFailure(parseAuditResultText(row.result_json));
}

function stripTrailingPathPunctuation(path: string): string {
  return path.replace(/[),.;:，。；：、]+$/u, '');
}

function isConcreteArtifactTarget(path: string): boolean {
  if (path.includes('://')) return false;
  if (PSEUDO_ARTIFACT_PATH_RE.test(path)) return false;
  if (path.startsWith('/') || path.startsWith('./') || path.startsWith('../')) return true;
  return CONCRETE_PATH_DIR_RE.test(path) || CONCRETE_PATH_EXTENSION_RE.test(path);
}

function extractConcreteArtifactTargets(taskDescription: string): string[] {
  const targets = new Set<string>();
  for (const match of taskDescription.matchAll(PATH_CANDIDATE_RE)) {
    const candidate = stripTrailingPathPunctuation(match[1]?.trim() ?? '');
    if (!candidate || !isConcreteArtifactTarget(candidate)) continue;
    targets.add(candidate);
  }
  return [...targets];
}

function targetMatchesTaskFocus(target: string, taskDescription: string): boolean {
  const task = taskDescription.toLowerCase();
  const normalizedTarget = target.toLowerCase();
  const asksForPdf =
    /\bpdf\b|02_analysis|analysis folder|分析报告|报告/u.test(task) && !/\bhtml\b/u.test(task);
  const asksForPresentation = /\bpptx?\b|presentation|03_presentation|幻灯片|演示/u.test(task);
  const asksForHtml = /\bhtml\b|infographic|04_infographic|信息图/u.test(task);
  const asksForManifest = /\bmanifest\b|05_evidence|evidence|证据/u.test(task);
  const asksForSourceCopy =
    /01_source_copy|source copy|source_project|copy|folder structure|复制|拷贝/u.test(task);

  if (
    asksForPdf &&
    (/\.pdf$/iu.test(normalizedTarget) || normalizedTarget.includes('/02_analysis/'))
  ) {
    return true;
  }
  if (
    asksForPresentation &&
    (/\.pptx?$/iu.test(normalizedTarget) || normalizedTarget.includes('/03_presentation/'))
  ) {
    return true;
  }
  if (
    asksForHtml &&
    (/\.html?$/iu.test(normalizedTarget) || normalizedTarget.includes('/04_infographic/'))
  ) {
    return true;
  }
  if (
    asksForManifest &&
    (/manifest\.json$/iu.test(normalizedTarget) || normalizedTarget.includes('/05_evidence/'))
  ) {
    return true;
  }
  if (
    asksForSourceCopy &&
    (normalizedTarget.includes('/01_source_copy/') ||
      normalizedTarget.includes('/source_project/') ||
      normalizedTarget.startsWith('deliverables/01_source_copy/'))
  ) {
    return true;
  }
  return !(
    asksForPdf ||
    asksForPresentation ||
    asksForHtml ||
    asksForManifest ||
    asksForSourceCopy
  );
}

function artifactTargetsForTask(taskDescription: string): string[] {
  const specificDescription = taskSpecificDescription(taskDescription);
  const specificTargets = extractConcreteArtifactTargets(specificDescription);
  if (specificTargets.length > 0) return specificTargets;

  const fullIntent = fullUserIntentDescription(taskDescription);
  if (!fullIntent) return [];
  const fullTargets = extractConcreteArtifactTargets(fullIntent);
  return fullTargets.filter((target) => targetMatchesTaskFocus(target, specificDescription));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function toolCallResponseSucceeded(response: {
  readonly success: boolean;
  readonly result: unknown;
  readonly error?: string;
}): boolean {
  if (!response.success) return false;
  const resultText =
    typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
  return !resultTextIndicatesFailure(resultText ?? '');
}

async function verifyRequestedArtifactTargets(input: {
  runtimeCtx: RuntimeContext;
  threadId: string;
  taskRunId: string;
  targets: readonly string[];
}): Promise<VerifyOutcome | null> {
  if (input.targets.length === 0) return null;
  const toolExecutor = (input.runtimeCtx as { toolExecutor?: RuntimeContext['toolExecutor'] })
    .toolExecutor;
  if (!toolExecutor) return null;

  const targetChecks = input.targets
    .map((target) =>
      [
        `p=${shellQuote(target)}`,
        'if [ -f "$p" ]; then',
        '  if [ ! -s "$p" ]; then echo "empty-file: $p"; missing=1; fi',
        'elif [ -d "$p" ]; then',
        '  if [ -z "$(find "$p" -type f -size +0c -print -quit 2>/dev/null)" ]; then echo "empty-directory: $p"; missing=1; fi',
        'else',
        '  echo "missing: $p"; missing=1',
        'fi',
      ].join('\n'),
    )
    .join('\n');
  const command = ['set -u', 'missing=0', targetChecks, 'exit "$missing"'].join('\n');
  const response = await toolExecutor.execute({
    toolCallId: generateId('tool'),
    name: 'bash',
    arguments: { command },
    nodeName: 'employee-completion',
    threadId: input.threadId,
    taskRunId: input.taskRunId,
  });
  if (toolCallResponseSucceeded(response)) return { ok: true };
  return {
    ok: false,
    reason: `Artifact/file completion requires non-empty files at requested local path(s): ${input.targets.join(
      ', ',
    )}.`,
  };
}

function rowMatchesTask(rowTaskRunId: string | null, taskRunId: string): boolean {
  return rowTaskRunId === taskRunId;
}

type DependencyConstraint = {
  readonly label: string;
  readonly usageRe: RegExp;
};

function dependencyConstraintsForTask(taskDescription: string): readonly DependencyConstraint[] {
  if (!DEPENDENCY_CONSTRAINT_CONTEXT_RE.test(taskDescription)) return [];
  const constraints: DependencyConstraint[] = [];
  if (REPORTLAB_USAGE_RE.test(taskDescription)) {
    constraints.push({ label: 'reportlab', usageRe: REPORTLAB_USAGE_RE });
  }
  if (/\bpython-pptx\b/iu.test(taskDescription)) {
    constraints.push({ label: 'python-pptx', usageRe: PYTHON_PPTX_USAGE_RE });
  }
  if (/\bnew packages?\b|\binstall\b|新增包|新增依赖|安装/u.test(taskDescription)) {
    constraints.push({ label: 'new package installation', usageRe: INSTALL_COMMAND_RE });
  }
  return constraints;
}

function auditRowSearchText(
  row: Pick<McpAuditRow, 'arguments_json' | 'result_json' | 'error' | 'tool_name'>,
): string {
  return [
    row.tool_name,
    row.arguments_json ?? '',
    parseAuditResultText(row.result_json),
    row.error ?? '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function verifyDependencyConstraints(input: {
  runtimeCtx: RuntimeContext;
  threadId: string;
  taskRunId: string;
  taskDescription: string;
}): Promise<VerifyOutcome | null> {
  const constraints = dependencyConstraintsForTask(input.taskDescription);
  if (constraints.length === 0) return null;

  const rows = (await input.runtimeCtx.repos.mcpAudit.listByThread(input.threadId)).filter((row) =>
    rowMatchesTask(row.task_run_id, input.taskRunId),
  );
  for (const row of rows) {
    const searchText = auditRowSearchText(row);
    const violation = constraints.find((constraint) => constraint.usageRe.test(searchText));
    if (!violation) continue;
    return {
      ok: false,
      reason: `Task violated the user's dependency constraint by using ${violation.label}.`,
    };
  }
  return null;
}

export async function verifyConcreteWriteEvidence(input: {
  runtimeCtx: RuntimeContext;
  threadId: string;
  taskRunId: string;
  taskDescription: string;
}): Promise<VerifyOutcome | null> {
  if (!requiresConcreteWriteEvidence(input.taskDescription)) return null;

  const rows = (await input.runtimeCtx.repos.mcpAudit.listByThread(input.threadId)).filter((row) =>
    rowMatchesTask(row.task_run_id, input.taskRunId),
  );
  const hasWriteEvidence = rows.some((row) => {
    if (!auditRowSucceeded(row)) return false;
    const args = parseJsonObject(row.arguments_json);
    if (row.tool_name === 'write_file') {
      return pickStringField(args, 'path').trim().length > 0;
    }
    if (row.tool_name !== 'bash') return false;
    const command = pickStringField(args, 'command');
    return BASH_WRITE_COMMAND_RE.test(command);
  });
  if (!hasWriteEvidence) {
    return {
      ok: false,
      reason:
        'Artifact/file completion requires a successful write/copy/create tool audit, not read/list evidence only.',
    };
  }
  const targetOutcome = await verifyRequestedArtifactTargets({
    runtimeCtx: input.runtimeCtx,
    threadId: input.threadId,
    taskRunId: input.taskRunId,
    targets: artifactTargetsForTask(input.taskDescription),
  });
  return targetOutcome ?? { ok: true };
}

async function verifyRoutingEventEvidence(input: {
  runtimeCtx: RuntimeContext;
  threadId: string;
  taskDescription: string;
}): Promise<VerifyOutcome | null> {
  if (!ROUTING_EVENT_EVIDENCE_RE.test(input.taskDescription)) return null;
  const events = await input.runtimeCtx.repos.events.findByThread(input.threadId);
  const hasRerouteEvent = events.some((event) => event.event_type === TASK_ASSIGNMENT_REROUTED);
  if (hasRerouteEvent) return { ok: true };
  return {
    ok: false,
    reason: 'Routing/rebind verification requires a real task.assignment.rerouted runtime event.',
  };
}

async function verifyTaskCompletion(input: {
  runtimeCtx: RuntimeContext;
  taskRunId: string;
  employeeId: string;
  state: OffisimGraphState;
  taskDescription: string;
}): Promise<VerifyOutcome> {
  const { runtimeCtx, taskRunId, employeeId, state, taskDescription } = input;
  // Per-task evidence is the UNION of per-turn intent (boss/preflight from
  // user message) AND per-task intent (PM-planner step description). PM can
  // decompose a generic ask into a specific "read README" step that demands
  // file evidence even when the original message did not — accepting only
  // the per-turn intent here would let a text-only completion pass.
  const turnIntent = state.taskToolIntent;
  const taskIntent = detectTaskToolIntent(taskDescription);
  const intent = turnIntent ? unionTaskToolIntents(turnIntent, taskIntent) : taskIntent;
  const evidenceTools = evidenceToolsForIntent(intent);
  const defaultOutcome =
    evidenceTools.length === 0
      ? ({ ok: true } as const)
      : verifyCompletion(
          {
            recentToolResults: state.recentToolResults ?? [],
          },
          { evidenceTools, taskRunId },
        );
  const routingEventOutcome = await verifyRoutingEventEvidence({
    runtimeCtx,
    threadId: state.threadId,
    taskDescription,
  });
  if (routingEventOutcome && !routingEventOutcome.ok) return routingEventOutcome;
  const dependencyOutcome = await verifyDependencyConstraints({
    runtimeCtx,
    threadId: state.threadId,
    taskRunId,
    taskDescription,
  });
  if (dependencyOutcome && !dependencyOutcome.ok) return dependencyOutcome;
  const concreteWriteOutcome = await verifyConcreteWriteEvidence({
    runtimeCtx,
    threadId: state.threadId,
    taskRunId,
    taskDescription,
  });
  if (concreteWriteOutcome && !concreteWriteOutcome.ok) return concreteWriteOutcome;
  let hookOutcome: VerifyOutcome | null = null;
  const payload: TaskCompletionVerifyingPayload = {
    taskRunId,
    employeeId,
    recentToolResults: state.recentToolResults ?? [],
    allow: () => {
      hookOutcome = { ok: true };
    },
    block: (reason) => {
      hookOutcome = { ok: false, reason };
    },
  };
  await runtimeCtx.hookRegistry.emit(
    'task.completion.verifying',
    payload as unknown as Record<string, unknown>,
  );
  return hookOutcome ?? defaultOutcome;
}

/**
 * Extract [N] citation references from an LLM response and map them
 * back to the citation entries that were injected into the prompt.
 * Returns only citations that were actually referenced in the text.
 */
export function extractUsedCitations(
  responseText: string,
  citationMap: CitationEntry[],
): CitationRef[] {
  if (citationMap.length === 0 || !responseText) return [];
  const usedIndices = new Set<number>();
  const re = /\[(\d+)]/g;
  let m = re.exec(responseText);
  while (m !== null) {
    const n = Number(m[1]);
    // Citation indices are 1-based; only keep bracketed numbers that map to a
    // real injected citation so stray markers like [0] / [99] are ignored.
    if (n >= 1 && citationMap.some((c) => c.index === n)) {
      usedIndices.add(n);
    }
    m = re.exec(responseText);
  }
  return citationMap
    .filter((c) => usedIndices.has(c.index))
    .map((c) => ({
      index: c.index,
      docTitle: c.docTitle,
      docId: c.docId,
      snippet: c.snippet,
    }));
}

export interface FinalizeSuccessContext {
  readonly runtimeCtx: RuntimeContext;
  readonly state: OffisimGraphState;
  readonly preflight: PreflightResult;
  readonly llmResponse: LlmResponse;
  readonly citationMap: CitationEntry[];
  readonly source: 'normal' | 'recovery';
  readonly round: number;
  readonly signal: AbortSignal | undefined;
  readonly materializedDeliverableOverride?: MaterializedEmployeeDeliverable | null;
  readonly skipVerification?: boolean;
}

/**
 * Shared completion path used by both happy-path and recovery-path.
 *
 * Side effects (in order):
 *   1. Materialize file deliverable if the response contains one (`materializeFileDeliverableIfNeeded`)
 *   2. Update task run status → `completed` with output JSON
 *   3. Emit `task.state.changed(running→completed)` + `task.assignment.changed(→unassigned)`
 *   4. Emit `task.subtask.progress(done)`
 *   5. Emit `employee.state.changed(executing→idle)`
 *   6. (normal only — and never for direct-chat / handoff-continuation) reflectAndRemember
 *   7. Extract citations from response
 *   8. `appendAgentEvent(action)` — payload differs by `source`
 *   9. `hookRegistry.emit('task.completed')` — completionType differs by `source`
 *   10. (normal only) write to scratchpad
 *   11. Emit `deliverable.created` if materialized
 *   12. Return `Partial<OffisimGraphState>` with final assistant message + step output entry
 */
export async function finalizeEmployeeSuccess(
  ctx: FinalizeSuccessContext,
): Promise<Partial<OffisimGraphState>> {
  const { runtimeCtx, state, preflight, llmResponse, citationMap, source, round, signal } = ctx;
  const {
    assignment,
    remaining,
    employee,
    taskRunId,
    taskLabel,
    totalAssignments,
    completedSoFar,
    isDirectChatTask,
    resolved,
    taskDescription,
  } = preflight;
  const { repos, eventBus, companyId, threadId, memoryService, scratchpad } = runtimeCtx;

  const completionOutcome = ctx.skipVerification
    ? ({ ok: true } as const)
    : taskRunId
      ? await verifyTaskCompletion({
          runtimeCtx,
          taskRunId,
          employeeId: employee.employee_id,
          state,
          taskDescription,
        })
      : ({ ok: false, reason: 'no-task-run-id' } as const);
  const nextTaskRunStatus = completionOutcome.ok ? 'completed' : 'blocked';
  const finalResponseContent = completionOutcome.ok
    ? llmResponse.content
    : `Task blocked: ${completionOutcome.reason}. Human review is required before this can be marked complete.`;

  const materializedDeliverable = completionOutcome.ok
    ? (ctx.materializedDeliverableOverride ??
      (await materializeFileDeliverableIfNeeded(
        runtimeCtx,
        taskDescription,
        employee,
        llmResponse,
        {
          model: resolved.model,
          provider: resolved.provider,
          temperature: resolved.temperature,
          maxTokens: resolved.maxTokens,
          signal,
        },
        taskRunId,
        state.projectId,
      )))
    : null;

  // Recovery path emits hookRegistry.emit INSIDE the taskRun update block
  // (pre-refactor order). Normal path fires it later, after appendAgentEvent.
  if (taskRunId) {
    await repos.taskRuns.updateStatus(
      taskRunId,
      nextTaskRunStatus,
      JSON.stringify({ content: finalResponseContent }),
    );
    eventBus.emit(
      taskStateChanged(
        companyId,
        taskRunId,
        'running',
        // review_ready is UI-only; SQLite task_runs.status persists the blocked state above.
        completionOutcome.ok ? 'completed' : 'review_ready',
        threadId,
        employee.employee_id,
        'employee',
        employee.name,
      ),
    );
    eventBus.emit(
      taskAssignmentChanged(companyId, taskRunId, employee.employee_id, 'unassigned', threadId, {
        employeeId: employee.employee_id,
        assigneeKind: 'employee',
        assigneeName: employee.name,
      }),
    );
    if (source === 'recovery' && completionOutcome.ok) {
      await runtimeCtx.hookRegistry.emit('task.completed', {
        threadId,
        companyId,
        employeeId: employee.employee_id,
        taskRunId,
        completionType: 'recovery',
      });
    }
  }

  eventBus.emit(
    taskSubtaskProgress(
      companyId,
      employee.employee_id,
      completedSoFar,
      taskLabel,
      completionOutcome.ok ? 'done' : 'failed',
      totalAssignments,
      completionOutcome.ok ? completedSoFar + 1 : completedSoFar,
      threadId,
      { employeeId: employee.employee_id, assigneeKind: 'employee', assigneeName: employee.name },
    ),
  );

  eventBus.emit(
    employeeStateChanged(companyId, employee.employee_id, 'executing', 'idle', threadId, taskRunId),
  );

  // reflectAndRemember runs only for normal path (recovery skipped — preserves
  // pre-refactor behavior where reflection was tied to happy-path only).
  if (completionOutcome.ok && source === 'normal' && memoryService) {
    const skipReflection =
      isDirectChatTask || assignment.taskType === TASK_TYPE_HANDOFF_CONTINUATION;
    try {
      await memoryService.reflectAndRemember(
        employee.employee_id,
        companyId,
        `Task: ${taskDescription}\n\nResponse: ${llmResponse.content}`,
        threadId,
        { skip: skipReflection, signal, model: resolved.model },
      );
    } catch (err) {
      logger.warn('reflectAndRemember failed', {
        error: err instanceof Error ? err.message : String(err),
        employeeId: employee.employee_id,
      });
    }
  }

  const usedCitations = completionOutcome.ok
    ? extractUsedCitations(llmResponse.content, citationMap)
    : [];

  if (!completionOutcome.ok) {
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `employee:${employee.employee_id}`,
      eventType: 'action',
      payload: {
        kind: 'completion-blocked',
        taskRunId,
        employeeName: employee.name,
        reason: completionOutcome.reason,
      },
    });
  } else if (source === 'normal') {
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `employee:${employee.employee_id}`,
      eventType: 'action',
      payload: {
        taskRunId,
        employeeName: employee.name,
        toolRounds: round,
        outputLength: llmResponse.content.length,
        citationCount: usedCitations.length,
      },
    });
    if (taskRunId) {
      await runtimeCtx.hookRegistry.emit('task.completed', {
        threadId,
        companyId,
        employeeId: employee.employee_id,
        taskRunId,
        completionType: 'response',
      });
    }
    scratchpad.write(
      `employee.last-output.${employee.employee_id}`,
      `${employee.name}: ${llmResponse.content.slice(0, 240)}`,
      'employee',
    );
  } else {
    // Recovery path: appendAgentEvent must not throw (pre-refactor guard).
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `employee:${employee.employee_id}`,
      eventType: 'action',
      payload: {
        taskRunId,
        employeeName: employee.name,
        recoveredFromError: true,
        outputLength: llmResponse.content.length,
      },
    }).catch(() => {});
  }

  if (materializedDeliverable) {
    runtimeCtx.eventBus.emit(
      deliverableCreated(
        runtimeCtx.companyId,
        generateId('del'),
        state.threadId,
        buildEmployeeDeliverableTitle(taskDescription, materializedDeliverable.fileName),
        materializedDeliverable.artifactContent,
        [
          {
            employeeId: employee.employee_id,
            employeeName: employee.name,
            sourceKind: 'employee',
            roleSlug: employee.role_slug,
            ...employeeBrandFields(employee),
          },
        ],
        {
          kind: materializedDeliverable.kind,
          fileName: materializedDeliverable.fileName,
          mimeType: materializedDeliverable.mimeType,
          chatThreadId: state.chatThreadId ?? null,
        },
      ),
    );
  }

  // Recovery path entry omits `citations` (preserve pre-refactor structure).
  const stepOutputEntry = {
    employeeId: employee.employee_id,
    employeeName: employee.name,
    sourceKind: 'employee' as const,
    roleSlug: employee.role_slug,
    content: finalResponseContent,
    taskRunId: taskRunId ?? '',
    stepIndex: preflight.stepIndex,
    ...employeeBrandFields(employee),
    artifact: materializedDeliverable
      ? {
          kind: materializedDeliverable.kind,
          fileName: materializedDeliverable.fileName,
          mimeType: materializedDeliverable.mimeType,
          content: materializedDeliverable.artifactContent,
        }
      : undefined,
    deliverableEventEmitted: materializedDeliverable ? true : undefined,
    ...(source === 'normal' && usedCitations.length > 0 ? { citations: usedCitations } : {}),
  };

  return {
    currentEmployeeId: employee.employee_id,
    currentTaskRunId: taskRunId ?? null,
    pendingAssignments: remaining,
    messages: [new AIMessage({ content: finalResponseContent })],
    currentStepOutputs: [...state.currentStepOutputs, stepOutputEntry],
    recentToolResults: state.recentToolResults ?? [],
  };
}
