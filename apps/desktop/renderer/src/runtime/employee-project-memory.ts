import { buildEnhanceRequest, runEnhance } from '@/assistant/enhance/service.js';
import { createTauriEnhanceTransport } from '@/assistant/enhance/tauri-enhance-transport.js';
import { containsSensitiveText, redactSecrets } from '@/data/redact-secrets.js';
export { buildProjectExperienceSection } from '@/data/employee-project-memory-format.js';
import type {
  AgentRunRow,
  CompetitiveDraftAttemptRow,
  CompetitiveDraftGroupRow,
  EmployeeProjectMemoryRow,
  EmployeeProjectMemoryType,
  RuntimeRepositories,
} from '@offisim/core/browser';

export const EMPLOYEE_PROJECT_MEMORY_LIMIT = 30;

const MEMORY_TYPES = new Set<EmployeeProjectMemoryType>([
  'pitfall',
  'repository_preference',
  'convention',
  'retrospective',
]);

export interface DistilledEmployeeMemoryCandidate {
  type: EmployeeProjectMemoryType;
  content: string;
  mergeIndex: number | null;
}

function normalizedMemoryText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function cleanCandidateContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const content = value.replace(/\s+/gu, ' ').trim().slice(0, 1_600);
  if (!content || containsSensitiveText(content)) return null;
  return content;
}

export function parseEmployeeMemoryCandidates(raw: string): DistilledEmployeeMemoryCandidate[] {
  const trimmed = raw.trim();
  const json = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
    : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const record = value as Record<string, unknown>;
      if (
        typeof record.type !== 'string' ||
        !MEMORY_TYPES.has(record.type as EmployeeProjectMemoryType)
      ) {
        return [];
      }
      const content = cleanCandidateContent(record.content);
      if (!content) return [];
      const mergeIndex =
        Number.isInteger(record.mergeIndex) && Number(record.mergeIndex) > 0
          ? Number(record.mergeIndex)
          : null;
      return [{ type: record.type as EmployeeProjectMemoryType, content, mergeIndex }];
    })
    .slice(0, 3);
}

function oldestUnhit(rows: readonly EmployeeProjectMemoryRow[]): EmployeeProjectMemoryRow | null {
  return (
    [...rows].sort((left, right) => {
      const leftAt = left.last_hit_at ?? left.created_at;
      const rightAt = right.last_hit_at ?? right.created_at;
      return leftAt.localeCompare(rightAt) || left.created_at.localeCompare(right.created_at);
    })[0] ?? null
  );
}

export async function applyEmployeeMemoryCandidates(input: {
  repos: RuntimeRepositories;
  companyId: string;
  employeeId: string;
  projectId: string;
  sourceRunId: string | null;
  candidates: readonly DistilledEmployeeMemoryCandidate[];
  now?: () => string;
}): Promise<void> {
  for (const candidate of input.candidates.slice(0, 3)) {
    const at = input.now?.() ?? new Date().toISOString();
    const existing = await input.repos.employeeProjectMemories.listByProject(
      input.employeeId,
      input.projectId,
    );
    const exact = existing.find(
      (row) => normalizedMemoryText(row.content) === normalizedMemoryText(candidate.content),
    );
    const indexed = candidate.mergeIndex ? existing[candidate.mergeIndex - 1] : null;
    const mergeTarget = exact ?? indexed ?? null;
    if (mergeTarget) {
      await input.repos.employeeProjectMemories.update(mergeTarget.memory_id, {
        memory_type: candidate.type,
        content: candidate.content,
        ...(input.sourceRunId ? { source_run_id: input.sourceRunId } : {}),
        updated_at: at,
      });
      continue;
    }
    if (existing.length >= EMPLOYEE_PROJECT_MEMORY_LIMIT) {
      const evicted = oldestUnhit(existing);
      if (evicted) await input.repos.employeeProjectMemories.delete(evicted.memory_id);
    }
    await input.repos.employeeProjectMemories.create({
      memory_id: `employee-memory-${crypto.randomUUID()}`,
      company_id: input.companyId,
      employee_id: input.employeeId,
      project_id: input.projectId,
      memory_type: candidate.type,
      content: candidate.content,
      source_run_id: input.sourceRunId,
      created_at: at,
      updated_at: at,
    });
  }
}

function memoryCatalog(rows: readonly EmployeeProjectMemoryRow[]): string {
  if (rows.length === 0) return '(none)';
  return rows.map((row, index) => `${index + 1}. [${row.memory_type}] ${row.content}`).join('\n');
}

function boundedOutcome(value: string | null | undefined): string {
  return redactSecrets(value?.trim() || '(no summary)').slice(0, 8_000);
}

async function extractAndApply(input: {
  repos: RuntimeRepositories;
  run: AgentRunRow;
  prompt: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (!input.run.employee_id || !input.run.project_id) return;
  const transport = createTauriEnhanceTransport({ threadId: input.run.thread_id });
  const result = await runEnhance(
    buildEnhanceRequest({
      profile: 'employee_memory_distill',
      text: input.prompt,
      locale: 'en',
      protectedSpans: [],
    }),
    transport,
    input.signal,
  );
  await applyEmployeeMemoryCandidates({
    repos: input.repos,
    companyId: input.run.company_id,
    employeeId: input.run.employee_id,
    projectId: input.run.project_id,
    sourceRunId: input.run.run_id,
    candidates: parseEmployeeMemoryCandidates(result.enhanced),
  });
}

export async function distillTerminalRunMemory(input: {
  repos: RuntimeRepositories;
  run: AgentRunRow;
  status: 'completed' | 'failed';
  summary: string | null | undefined;
  signal?: AbortSignal;
}): Promise<void> {
  if (!input.run.employee_id || !input.run.project_id) return;
  const existing = await input.repos.employeeProjectMemories.listByProject(
    input.run.employee_id,
    input.run.project_id,
  );
  const prompt = [
    `Task objective: ${boundedOutcome(input.run.objective)}`,
    `Task status: ${input.status}`,
    `Outcome: ${boundedOutcome(input.summary)}`,
    '',
    'Existing memories (use mergeIndex when replacing one):',
    memoryCatalog(existing),
  ].join('\n');
  await extractAndApply({ repos: input.repos, run: input.run, prompt, signal: input.signal });
}

export async function distillCompetitiveDraftLoserMemory(input: {
  repos: RuntimeRepositories;
  group: CompetitiveDraftGroupRow;
  winner: CompetitiveDraftAttemptRow;
  loser: CompetitiveDraftAttemptRow;
}): Promise<void> {
  const run = await input.repos.agentRuns.findById(input.loser.run_id);
  if (!run?.employee_id || !run.project_id) return;
  const existing = await input.repos.employeeProjectMemories.listByProject(
    run.employee_id,
    run.project_id,
  );
  const prompt = [
    `Comparison objective: ${boundedOutcome(input.group.objective)}`,
    `Losing draft outcome: ${boundedOutcome(input.loser.result_summary_json)}`,
    `Winning draft outcome: ${boundedOutcome(input.winner.result_summary_json)}`,
    'Extract only a retrospective lesson explaining why this draft lost and how to improve next time.',
    '',
    'Existing memories (use mergeIndex when replacing one):',
    memoryCatalog(existing),
  ].join('\n');
  await extractAndApply({ repos: input.repos, run, prompt });
}

export async function createManualEmployeeProjectMemory(input: {
  repos: RuntimeRepositories;
  companyId: string;
  employeeId: string;
  projectId: string;
  type: EmployeeProjectMemoryType;
  content: string;
}): Promise<void> {
  const content = cleanCandidateContent(input.content);
  if (!content) throw new Error('Experience cannot contain credentials or be empty.');
  await applyEmployeeMemoryCandidates({
    repos: input.repos,
    companyId: input.companyId,
    employeeId: input.employeeId,
    projectId: input.projectId,
    sourceRunId: null,
    candidates: [{ type: input.type, content, mergeIndex: null }],
  });
}

export function validateEmployeeProjectMemoryContent(content: string): string {
  const cleaned = cleanCandidateContent(content);
  if (!cleaned) throw new Error('Experience cannot contain credentials or be empty.');
  return cleaned;
}
