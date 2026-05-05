import type { OffisimGraphState } from '../graph/state.js';
import type { RuntimeContext } from './runtime-context.js';

export interface ActiveContextSnapshot {
  readonly companyId: string;
  readonly companyName: string | null;
  readonly projectId: string | null;
  readonly workspaceRoot: string | null;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly defaultProvider: string | null;
  readonly defaultModel: string | null;
}

export async function resolveActiveContextSnapshot(input: {
  readonly runtimeCtx: RuntimeContext;
  readonly state: Pick<OffisimGraphState, 'threadId' | 'projectId'>;
  readonly employeeId?: string | null;
}): Promise<ActiveContextSnapshot> {
  const { runtimeCtx, state } = input;
  const [company, graphThread, employee] = await Promise.all([
    runtimeCtx.repos.companies.findById(runtimeCtx.companyId),
    runtimeCtx.repos.threads.findById(state.threadId),
    input.employeeId ? runtimeCtx.repos.employees.findById(input.employeeId) : null,
  ]);
  const projectId = state.projectId ?? graphThread?.project_id ?? null;
  const project = projectId ? await runtimeCtx.repos.projects.findById(projectId) : null;
  const defaultModelPolicy = runtimeCtx.runtimePolicy?.modelPolicy.default;

  return {
    companyId: runtimeCtx.companyId,
    companyName: company?.name ?? null,
    projectId,
    workspaceRoot: project?.workspace_root ?? null,
    employeeId: input.employeeId ?? null,
    employeeName: employee?.name ?? null,
    defaultProvider: defaultModelPolicy?.provider ?? null,
    defaultModel: defaultModelPolicy?.model ?? null,
  };
}
