import { TASK_ASSIGNMENT_REROUTED } from '@offisim/shared-types';
import type { OffisimGraphState } from '../graph/state.js';
import { type VerifyOutcome, verifyCompletion } from '../runtime/completion-verifier.js';
import type { TaskCompletionVerifyingPayload } from '../runtime/hook-registry.js';
import type { McpAuditRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';
import {
  detectTaskToolIntent,
  evidenceToolsForIntent,
  unionTaskToolIntents,
} from './task-tool-intent.js';

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

export async function verifyTaskCompletion(input: {
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
