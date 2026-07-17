import { useUiState } from '@/app/ui-state.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import {
  EMPLOYEE_MEMORY_TYPE_LABELS,
  createManualEmployeeProjectMemory,
  validateEmployeeProjectMemoryContent,
} from '@/runtime/employee-project-memory.js';
import { getRepos } from '@/runtime/repos.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import type {
  AgentRunRow,
  EmployeeProjectMemoryRow,
  EmployeeProjectMemoryType,
} from '@offisim/core/browser';
import type { ProjectRow } from '@offisim/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Lightbulb, Pin, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

const TYPE_OPTIONS = Object.entries(EMPLOYEE_MEMORY_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

interface ExperienceSource {
  run: AgentRunRow;
  title: string;
}

interface ExperienceData {
  memories: EmployeeProjectMemoryRow[];
  projects: ProjectRow[];
  sources: Map<string, ExperienceSource>;
  completedTasks: number;
  activeProjects: number;
  comparisonWins: number;
  comparisonEntries: number;
}

function useEmployeeExperience(employeeId: string, companyId: string) {
  return useQuery({
    queryKey: ['personnel', 'experience', employeeId],
    queryFn: async (): Promise<ExperienceData> => {
      const repos = await getRepos();
      const [memories, projects, runs, attempts] = await Promise.all([
        repos.employeeProjectMemories.listByEmployee(employeeId),
        repos.projects.findByCompany(companyId),
        repos.agentRuns.findByEmployee(employeeId),
        repos.competitiveDraftAttempts.listByEmployee(employeeId),
      ]);
      const sourceRunIds = new Set(
        memories.flatMap((memory) => (memory.source_run_id ? [memory.source_run_id] : [])),
      );
      const sourceRuns = new Map(
        runs.filter((run) => sourceRunIds.has(run.run_id)).map((run) => [run.run_id, run]),
      );
      const sources = new Map<string, ExperienceSource>();
      await Promise.all(
        [...sourceRuns.values()].map(async (run) => {
          const thread = await repos.chatThreads.findById(run.thread_id);
          sources.set(run.run_id, {
            run,
            title: thread?.title?.trim() || run.objective?.trim() || 'Task conversation',
          });
        }),
      );
      const rootRuns = runs.filter((run) => run.run_id === run.root_run_id);
      return {
        memories,
        projects,
        sources,
        completedTasks: rootRuns.filter((run) => run.status === 'completed').length,
        activeProjects: new Set(rootRuns.flatMap((run) => (run.project_id ? [run.project_id] : [])))
          .size,
        comparisonWins: attempts.filter((attempt) => attempt.status === 'winner').length,
        comparisonEntries: attempts.length,
      };
    },
  });
}

function ExperienceSummary({ data }: { data: ExperienceData }) {
  const metrics = [
    { label: 'Tasks completed', value: data.completedTasks },
    { label: 'Draft wins', value: `${data.comparisonWins}/${data.comparisonEntries}` },
    { label: 'Active projects', value: data.activeProjects },
  ];
  return (
    <section className="off-pers-exp-summary" aria-label="Employee experience summary">
      {metrics.map((metric) => (
        <div key={metric.label} className="off-pers-exp-stat">
          <strong>{metric.value}</strong>
          <span>{metric.label}</span>
        </div>
      ))}
    </section>
  );
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function ExperienceTab({
  employeeId,
  companyId,
}: { employeeId: string; companyId: string }) {
  const query = useEmployeeExperience(employeeId, companyId);
  const queryClient = useQueryClient();
  const setSurface = useUiState((state) => state.setSurface);
  const requestThreadFocus = useUiState((state) => state.requestThreadFocus);
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<EmployeeProjectMemoryType>('pitfall');
  const [content, setContent] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteMemory, setDeleteMemory] = useState<EmployeeProjectMemoryRow | null>(null);
  const data = query.data;
  const availableProjects = useMemo(
    () => data?.projects.filter((project) => project.status !== 'archived') ?? [],
    [data?.projects],
  );

  useEffect(() => {
    if (!projectId && availableProjects[0]) setProjectId(availableProjects[0].project_id);
  }, [availableProjects, projectId]);

  const projectMap = useMemo(
    () => new Map((data?.projects ?? []).map((project) => [project.project_id, project])),
    [data?.projects],
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, EmployeeProjectMemoryRow[]>();
    for (const memory of data?.memories ?? []) {
      const rows = grouped.get(memory.project_id) ?? [];
      rows.push(memory);
      grouped.set(memory.project_id, rows);
    }
    return [...grouped.entries()].sort(([left], [right]) =>
      (projectMap.get(left)?.name ?? '').localeCompare(projectMap.get(right)?.name ?? ''),
    );
  }, [data?.memories, projectMap]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['personnel', 'experience', employeeId] });

  const runMutation = async (memoryId: string, action: () => Promise<void>, success: string) => {
    setPendingId(memoryId);
    try {
      await action();
      await refresh();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error('Experience update failed', {
        description: error instanceof Error ? error.message : 'The change could not be saved.',
      });
      return false;
    } finally {
      setPendingId(null);
    }
  };

  const addExperience = async () => {
    if (!projectId || !content.trim()) return;
    setPendingId('new');
    try {
      const repos = await getRepos();
      await createManualEmployeeProjectMemory({
        repos,
        companyId,
        employeeId,
        projectId,
        type,
        content,
      });
      setContent('');
      await refresh();
      toast.success('Experience added');
    } catch (error) {
      toast.error('Experience could not be added', {
        description: error instanceof Error ? error.message : 'The entry could not be saved.',
      });
    } finally {
      setPendingId(null);
    }
  };

  if (query.isLoading) {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll">
          <SkeletonRows rows={5} />
        </div>
      </div>
    );
  }
  if (query.isError || !data) {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll">
          <ErrorState
            title="Couldn't load experience"
            detail={errorDetail(query.error, 'Project experience could not be loaded.')}
            onRetry={() => void query.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll off-pers-exp-scroll">
        <ExperienceSummary data={data} />

        <section className="off-pers-exp-compose">
          <CapsLabel>Add project experience</CapsLabel>
          {availableProjects.length > 0 ? (
            <div className="off-pers-exp-compose-grid">
              <Select
                aria-label="Project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                options={availableProjects.map((project) => ({
                  value: project.project_id,
                  label: project.name,
                }))}
              />
              <Select
                aria-label="Experience type"
                value={type}
                onChange={(event) => setType(event.target.value as EmployeeProjectMemoryType)}
                options={TYPE_OPTIONS}
              />
              <Textarea
                aria-label="New experience"
                value={content}
                placeholder="A concrete lesson this employee should apply on the next task…"
                onChange={(event) => setContent(event.target.value)}
              />
              <Button
                size="sm"
                disabled={!content.trim() || pendingId === 'new'}
                onClick={() => void addExperience()}
              >
                <Plus aria-hidden="true" /> {pendingId === 'new' ? 'Adding…' : 'Add experience'}
              </Button>
            </div>
          ) : (
            <p className="off-pers-exp-help">Create a Project before adding project experience.</p>
          )}
        </section>

        {groups.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="No project experience yet"
            description="Lessons distilled from completed and failed tasks will appear here. You can also add one above."
          />
        ) : (
          groups.map(([groupProjectId, memories]) => (
            <section key={groupProjectId} className="off-pers-exp-project">
              <div className="off-pers-exp-project-head">
                <h3>{projectMap.get(groupProjectId)?.name ?? 'Past project'}</h3>
                <span>
                  {memories.length} {memories.length === 1 ? 'lesson' : 'lessons'}
                </span>
              </div>
              <div className="off-pers-exp-list">
                {memories.map((memory) => {
                  const source = memory.source_run_id
                    ? data.sources.get(memory.source_run_id)
                    : null;
                  return (
                    <article key={memory.memory_id} className="off-pers-exp-card">
                      <div className="off-pers-exp-card-head">
                        <Select
                          aria-label="Experience type"
                          value={memory.memory_type}
                          disabled={pendingId === memory.memory_id}
                          onChange={(event) => {
                            const nextType = event.target.value as EmployeeProjectMemoryType;
                            void runMutation(
                              memory.memory_id,
                              async () => {
                                const repos = await getRepos();
                                await repos.employeeProjectMemories.update(memory.memory_id, {
                                  memory_type: nextType,
                                });
                              },
                              'Experience type updated',
                            );
                          }}
                          options={TYPE_OPTIONS}
                        />
                        <div className="off-pers-exp-card-actions">
                          <Button
                            variant={memory.pinned ? 'accentSoft' : 'ghost'}
                            size="iconSm"
                            title={memory.pinned ? 'Unpin experience' : 'Pin experience'}
                            aria-label={memory.pinned ? 'Unpin experience' : 'Pin experience'}
                            disabled={pendingId === memory.memory_id}
                            onClick={() =>
                              void runMutation(
                                memory.memory_id,
                                async () => {
                                  const repos = await getRepos();
                                  await repos.employeeProjectMemories.update(memory.memory_id, {
                                    pinned: !memory.pinned,
                                  });
                                },
                                memory.pinned ? 'Experience unpinned' : 'Experience pinned',
                              )
                            }
                          >
                            <Pin aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="iconSm"
                            title="Delete experience"
                            aria-label="Delete experience"
                            disabled={pendingId === memory.memory_id}
                            onClick={() => setDeleteMemory(memory)}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        key={`${memory.memory_id}-${memory.updated_at}`}
                        className="off-pers-exp-text"
                        aria-label="Experience content"
                        defaultValue={memory.content}
                        disabled={pendingId === memory.memory_id}
                        onBlur={(event) => {
                          if (event.target.value === memory.content) return;
                          void runMutation(
                            memory.memory_id,
                            async () => {
                              const repos = await getRepos();
                              await repos.employeeProjectMemories.update(memory.memory_id, {
                                content: validateEmployeeProjectMemoryContent(event.target.value),
                                updated_at: new Date().toISOString(),
                              });
                            },
                            'Experience updated',
                          );
                        }}
                      />
                      <footer className="off-pers-exp-meta">
                        <span>
                          {memory.pinned ? 'Pinned · ' : ''}Used {memory.hit_count}{' '}
                          {memory.hit_count === 1 ? 'time' : 'times'} · Updated{' '}
                          {formatUpdatedAt(memory.updated_at)}
                        </span>
                        {source ? (
                          <button
                            type="button"
                            className="off-pers-exp-source off-focusable"
                            onClick={() => {
                              if (!source.run.project_id) return;
                              setSurface('office');
                              requestThreadFocus({
                                projectId: source.run.project_id,
                                threadId: source.run.thread_id,
                              });
                            }}
                          >
                            From {source.title} <ExternalLink aria-hidden="true" />
                          </button>
                        ) : (
                          <span>Added manually</span>
                        )}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <Dialog
        open={Boolean(deleteMemory)}
        onOpenChange={(open) => {
          if (!open) setDeleteMemory(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this experience?</DialogTitle>
            <DialogDescription>
              The employee will no longer receive this lesson on future tasks.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="subtle" onClick={() => setDeleteMemory(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteMemory || pendingId === deleteMemory.memory_id}
              onClick={() => {
                if (!deleteMemory) return;
                const memory = deleteMemory;
                void runMutation(
                  memory.memory_id,
                  async () => {
                    const repos = await getRepos();
                    await repos.employeeProjectMemories.delete(memory.memory_id);
                  },
                  'Experience deleted',
                ).then((saved) => {
                  if (saved) setDeleteMemory(null);
                });
              }}
            >
              <Trash2 aria-hidden="true" /> Delete experience
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
