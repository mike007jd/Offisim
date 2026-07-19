import { useUiState } from '@/app/ui-state.js';
import { useProjectWorkspaceLeaseReviews, useTaskBoard } from '@/data/board/task-board-data.js';
import {
  type CommandExecResult,
  commitGitChanges,
  createPullRequest,
  getGhAuthStatus,
  getOriginRemote,
  getPullRequestStatus,
  listPullRequests,
  pushGitBranch,
  stageGitFiles,
  switchGitBranch,
  viewPullRequest,
} from '@/data/git-workbench.js';
import { queryKeys } from '@/data/query-keys.js';
import type { GitFileChange, GitWorkbench } from '@/data/types.js';
import { parseUnifiedDiffFiles } from '@/data/unified-diff.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { cn } from '@/lib/utils.js';
import { useReviewPrPrefill } from '@/surfaces/office/board/review-pr-prefill.js';
import { useQueryClient } from '@tanstack/react-query';
import { GitBranch, GitCompareArrows, GitPullRequest, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

const STATUS_GLYPH: Record<GitFileChange['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

function commandOutput(result: CommandExecResult) {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
}

async function loadGitConnections(projectId: string) {
  const [originResult, authResult] = await Promise.allSettled([
    getOriginRemote(projectId),
    getGhAuthStatus(projectId),
  ]);
  const rejected = (reason: unknown): CommandExecResult => ({
    ok: false,
    stdout: '',
    stderr: reason instanceof Error ? reason.message : String(reason),
  });
  return {
    origin:
      originResult.status === 'fulfilled' ? originResult.value : rejected(originResult.reason),
    auth: authResult.status === 'fulfilled' ? authResult.value : rejected(authResult.reason),
  };
}

export function GitTab({
  workbench,
  companyId,
  projectId,
}: {
  workbench: GitWorkbench;
  companyId: string;
  projectId: string;
}) {
  const projectIdRef = useRef(projectId);
  const projectGenerationRef = useRef(0);
  if (projectIdRef.current !== projectId) {
    projectIdRef.current = projectId;
    projectGenerationRef.current += 1;
  }
  const captureProjectScope = () => ({
    projectId: projectIdRef.current,
    generation: projectGenerationRef.current,
  });
  const isCurrentProjectScope = (scope: { projectId: string; generation: number }) =>
    scope.projectId === projectIdRef.current && scope.generation === projectGenerationRef.current;
  const openStageView = useUiState((s) => s.openStageView);
  const setStageMaximized = useUiState((s) => s.setOfficeStageMaximized);
  const queryClient = useQueryClient();
  const leaseReviews = useProjectWorkspaceLeaseReviews(projectId);
  const board = useTaskBoard(companyId);
  const taskByRun = new Map(
    board.rows.flatMap((row) => [row, ...row.children]).map((row) => [row.runId, row]),
  );
  const reviewable = leaseReviews.rows.filter((lease) => lease.status === 'pending_review');
  const [selectedLeaseId, setSelectedLeaseId] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [origin, setOrigin] = useState<CommandExecResult | null>(null);
  const [ghAuth, setGhAuth] = useState<CommandExecResult | null>(null);
  const [prStatus, setPrStatus] = useState<CommandExecResult | null>(null);
  const [prList, setPrList] = useState<CommandExecResult | null>(null);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prBase, setPrBase] = useState('');
  const [prDraft, setPrDraft] = useState(false);
  const prPrefill = useReviewPrPrefill(projectId);
  const consumedPrPrefillId = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'push' | 'create-pr' | 'view-pr' | null>(null);
  const [lastOutput, setLastOutput] = useState<{ label: string; result: CommandExecResult } | null>(
    null,
  );
  const selectedLease =
    reviewable.find((lease) => lease.leaseId === selectedLeaseId) ?? reviewable[0] ?? null;
  const task = selectedLease ? taskByRun.get(selectedLease.runId) : null;
  const selectedLeaseDocument = useMemo(
    () => parseUnifiedDiffFiles(selectedLease?.files ?? []),
    [selectedLease?.files],
  );

  const openLeaseReview = (lease: (typeof reviewable)[number]) => {
    openStageView({
      kind: 'changes',
      leaseId: lease.leaseId,
      path: lease.files[0]?.path,
      files: lease.files,
      status: lease.status,
    });
    setStageMaximized(true);
  };

  useEffect(() => {
    const generation = projectGenerationRef.current;
    void loadGitConnections(projectId).then((connections) => {
      if (projectIdRef.current !== projectId || projectGenerationRef.current !== generation) {
        return;
      }
      setOrigin(connections.origin);
      setGhAuth(connections.auth);
    });
    return () => {
      projectGenerationRef.current += 1;
    };
  }, [projectId]);

  useEffect(() => {
    if (!prPrefill || consumedPrPrefillId.current === prPrefill.id) return;
    consumedPrPrefillId.current = prPrefill.id;
    setPrTitle((current) => current.trim() || prPrefill.title);
    setPrBody((current) =>
      current.includes(prPrefill.body)
        ? current
        : current.trim()
          ? `${current.trim()}\n\n${prPrefill.body}`
          : prPrefill.body,
    );
    setPrDraft(true);
  }, [prPrefill]);

  const refreshConnections = async () => {
    const scope = captureProjectScope();
    setBusy('Check setup');
    const connections = await loadGitConnections(scope.projectId);
    if (!isCurrentProjectScope(scope)) return;
    setOrigin(connections.origin);
    setGhAuth(connections.auth);
    setLastOutput({ label: 'GitHub CLI auth status', result: connections.auth });
    setBusy(null);
  };

  const refreshGit = async (targetProjectId: string) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.gitWorkbench(targetProjectId) });
  };

  const execute = async (
    label: string,
    operation: (targetProjectId: string) => Promise<CommandExecResult>,
    afterSuccess?: (targetProjectId: string) => void | Promise<void>,
  ) => {
    const scope = captureProjectScope();
    setBusy(label);
    try {
      const result = await operation(scope.projectId);
      if (!isCurrentProjectScope(scope)) return;
      setLastOutput({ label, result });
      if (!result.ok) {
        toast.error(`${label} failed`);
        return;
      }
      await afterSuccess?.(scope.projectId);
      if (!isCurrentProjectScope(scope)) return;
      toast.success(`${label} completed`);
    } catch (error) {
      if (!isCurrentProjectScope(scope)) return;
      const result = {
        ok: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      };
      setLastOutput({ label, result });
      toast.error(`${label} failed`);
    } finally {
      if (isCurrentProjectScope(scope)) setBusy(null);
    }
  };

  const refreshPullRequests = async (recordOutput = true) => {
    const scope = captureProjectScope();
    setBusy('Refresh PRs');
    try {
      const [status, list] = await Promise.all([
        getPullRequestStatus(scope.projectId),
        listPullRequests(scope.projectId),
      ]);
      if (!isCurrentProjectScope(scope)) return;
      setPrStatus(status);
      setPrList(list);
      if (recordOutput) setLastOutput({ label: 'PR status', result: status.ok ? list : status });
    } catch (error) {
      if (!isCurrentProjectScope(scope)) return;
      setLastOutput({
        label: 'Refresh PRs',
        result: {
          ok: false,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      if (isCurrentProjectScope(scope)) setBusy(null);
    }
  };

  return (
    <div className="off-gw">
      <div className="off-gw-branch">
        <Icon icon={GitBranch} size="sm" />
        <span className="off-gw-branch-name">{workbench.branch}</span>
        <span className="off-gw-counts">
          ↑{workbench.ahead} ↓{workbench.behind}
        </span>
      </div>

      <div className="off-gw-section off-gw-action-section">
        <CapsLabel>Stage &amp; commit</CapsLabel>
        <div className="off-gw-files">
          {workbench.changes.map((change) => (
            <label key={`stage-${change.path}`} className="off-gw-stage-row">
              <input
                type="checkbox"
                checked={change.staged || selectedPaths.includes(change.path)}
                disabled={change.staged || busy !== null}
                onChange={(event) =>
                  setSelectedPaths((current) =>
                    event.target.checked
                      ? [...current, change.path]
                      : current.filter((path) => path !== change.path),
                  )
                }
              />
              <span className="off-gw-path">{change.path}</span>
              <span>{change.staged ? 'staged' : 'unstaged'}</span>
            </label>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={selectedPaths.length === 0 || busy !== null}
          onClick={() =>
            void execute(
              'Stage files',
              (targetProjectId) => stageGitFiles(targetProjectId, selectedPaths),
              async (targetProjectId) => {
                setSelectedPaths([]);
                await refreshGit(targetProjectId);
              },
            )
          }
        >
          Stage selected ({selectedPaths.length})
        </Button>
        <Input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit message"
          aria-label="Commit message"
        />
        <Button
          size="sm"
          disabled={!commitMessage.trim() || busy !== null}
          onClick={() =>
            void execute(
              'Commit',
              (targetProjectId) => commitGitChanges(targetProjectId, commitMessage.trim()),
              async (targetProjectId) => {
                setCommitMessage('');
                await refreshGit(targetProjectId);
              },
            )
          }
        >
          Commit staged changes
        </Button>
      </div>

      <div className="off-gw-section off-gw-action-section">
        <CapsLabel>Branch</CapsLabel>
        <Input
          value={branchName}
          onChange={(event) => setBranchName(event.target.value)}
          placeholder="feature/branch-name"
          aria-label="Branch name"
        />
        <div className="off-gw-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={!branchName.trim() || busy !== null}
            onClick={() =>
              void execute(
                'Switch branch',
                (targetProjectId) => switchGitBranch(targetProjectId, branchName.trim(), false),
                refreshGit,
              )
            }
          >
            Switch
          </Button>
          <Button
            size="sm"
            disabled={!branchName.trim() || busy !== null}
            onClick={() =>
              void execute(
                'Create branch',
                (targetProjectId) => switchGitBranch(targetProjectId, branchName.trim(), true),
                async (targetProjectId) => {
                  setBranchName('');
                  await refreshGit(targetProjectId);
                },
              )
            }
          >
            Create &amp; switch
          </Button>
        </div>
      </div>

      <div className="off-gw-section off-gw-action-section">
        <CapsLabel>Push</CapsLabel>
        {origin?.ok ? (
          <div className="off-gw-remote">origin · {origin.stdout.trim()}</div>
        ) : (
          <div className="off-gw-guidance">
            No origin remote is configured. Add origin in a terminal, then refresh this panel.
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!origin?.ok || workbench.branch === 'detached' || busy !== null}
          onClick={() => setConfirming('push')}
        >
          <Upload size={14} /> Push {workbench.branch}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void refreshConnections()}
        >
          Check remote &amp; CLI setup
        </Button>
      </div>

      <div className="off-gw-section off-gw-action-section">
        <CapsLabel>Pull requests</CapsLabel>
        {ghAuth?.ok ? (
          <div className="off-gw-guidance is-ok">GitHub CLI authenticated.</div>
        ) : (
          <div className="off-gw-guidance">
            GitHub CLI is unavailable or not logged in. Install `gh` or run `gh auth login` in a
            terminal, then refresh.
          </div>
        )}
        {ghAuth ? <pre className="off-gw-output">{commandOutput(ghAuth)}</pre> : null}
        <div className="off-gw-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={!ghAuth?.ok || busy !== null}
            onClick={() => void refreshPullRequests()}
          >
            Refresh PRs
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ghAuth?.ok || busy !== null}
            onClick={() =>
              void execute('View PR', (targetProjectId) => viewPullRequest(targetProjectId))
            }
          >
            View current
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ghAuth?.ok || busy !== null}
            onClick={() => setConfirming('view-pr')}
          >
            Open web
          </Button>
        </div>
        {prStatus ? <pre className="off-gw-output">{commandOutput(prStatus)}</pre> : null}
        {prList ? <pre className="off-gw-output">{commandOutput(prList)}</pre> : null}
        <Input
          value={prTitle}
          onChange={(event) => setPrTitle(event.target.value)}
          placeholder="PR title"
          aria-label="PR title"
        />
        <Textarea
          value={prBody}
          onChange={(event) => setPrBody(event.target.value)}
          placeholder="PR body"
          aria-label="PR body"
          rows={4}
        />
        <Input
          value={prBase}
          onChange={(event) => setPrBase(event.target.value)}
          placeholder="Base branch (optional)"
          aria-label="PR base branch"
        />
        <label className="off-gw-check-row">
          <input
            type="checkbox"
            checked={prDraft}
            onChange={(event) => setPrDraft(event.target.checked)}
          />
          Create as draft
        </label>
        <Button
          className="off-gw-pr-create"
          size="sm"
          disabled={!ghAuth?.ok || !prTitle.trim() || busy !== null}
          onClick={() => setConfirming('create-pr')}
        >
          <GitPullRequest size={14} /> <span>Review PR creation</span>
        </Button>
      </div>

      {selectedLease ? (
        <div className="off-gw-section">
          <CapsLabel>Task diff review</CapsLabel>
          <Select
            className="off-gw-task-select off-focusable"
            value={selectedLease.leaseId}
            onChange={(event) => {
              const next = reviewable.find((lease) => lease.leaseId === event.target.value);
              setSelectedLeaseId(event.target.value);
              if (next) openLeaseReview(next);
            }}
            aria-label="Delegated task diff"
            options={reviewable.map((lease) => ({
              value: lease.leaseId,
              label: taskByRun.get(lease.runId)?.objective ?? lease.runId,
            }))}
          />
          <div className="off-gw-review-entry">
            <div className="off-gw-review-entry-head">
              <span>Pending review</span>
              <strong>{selectedLeaseDocument.files.length} files</strong>
            </div>
            <p>{task?.objective ?? selectedLease.branch ?? selectedLease.leaseId}</p>
            <div className="off-gw-review-entry-stats">
              <span>+{selectedLeaseDocument.additions}</span>
              <span>−{selectedLeaseDocument.deletions}</span>
              <span>{selectedLeaseDocument.files.length} files</span>
            </div>
            <Button size="sm" onClick={() => openLeaseReview(selectedLease)}>
              <GitCompareArrows size={14} /> Open review stage
            </Button>
          </div>
        </div>
      ) : null}

      <div className="off-gw-section">
        <CapsLabel>Changes · {workbench.changes.length}</CapsLabel>
        <div className="off-gw-files">
          {workbench.changes.map((change) => (
            <button
              key={change.path}
              type="button"
              className="off-gw-file off-focusable"
              onClick={() => openStageView({ kind: 'changes', path: change.path })}
            >
              <span className={cn('off-gw-status', `is-${change.status}`)}>
                {STATUS_GLYPH[change.status]}
              </span>
              {change.staged ? <span className="off-gw-stage">staged</span> : null}
              <span className="off-gw-path">{change.path}</span>
              <span className="off-gw-stat">
                <span className="off-gw-add">+{change.added}</span>
                <span className="off-gw-rem">−{change.removed}</span>
              </span>
            </button>
          ))}
          {workbench.changes.length === 0 ? (
            <div className="off-gw-empty">No local changes</div>
          ) : null}
        </div>
      </div>

      <div className="off-gw-section">
        <CapsLabel>Diff preview</CapsLabel>
        <pre className="off-gw-diff">
          {workbench.diffPreview.map((line, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static diff lines
              key={i}
              className={cn('off-gw-diff-line', `is-${line.kind}`)}
            >
              {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
              {line.text}
            </span>
          ))}
        </pre>
      </div>

      <div className="off-gw-checks">
        {workbench.checks.map((check) => (
          <span key={check.id} className={cn('off-gw-check', `is-${check.state}`)}>
            <span className="off-gw-check-dot" />
            {check.label}
          </span>
        ))}
      </div>
      {lastOutput ? (
        <div className={cn('off-gw-result', lastOutput.result.ok ? 'is-ok' : 'is-error')}>
          <strong>{lastOutput.label}</strong>
          <pre>{commandOutput(lastOutput.result) || 'Completed with no output.'}</pre>
        </div>
      ) : null}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent showClose={false} className="off-dialog-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirming === 'push'
                ? 'Confirm push'
                : confirming === 'create-pr'
                  ? 'Confirm pull request'
                  : 'Open pull request in browser'}
            </DialogTitle>
            <DialogDescription>
              {confirming === 'push'
                ? 'This updates the shared origin remote.'
                : confirming === 'create-pr'
                  ? 'Review the exact title, body and base before creating the remote pull request.'
                  : 'This opens the current pull request using GitHub CLI.'}
            </DialogDescription>
          </DialogHeader>
          {confirming === 'push' ? (
            <dl className="off-gw-confirm">
              <dt>Remote</dt>
              <dd>origin</dd>
              <dt>Branch</dt>
              <dd>{workbench.branch}</dd>
            </dl>
          ) : confirming === 'create-pr' ? (
            <dl className="off-gw-confirm">
              <dt>Title</dt>
              <dd>{prTitle}</dd>
              <dt>Base</dt>
              <dd>{prBase || 'repository default'}</dd>
              <dt>Mode</dt>
              <dd>{prDraft ? 'draft' : 'ready for review'}</dd>
              <dt>Body</dt>
              <dd className="is-prewrap">{prBody || '(empty)'}</dd>
            </dl>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const action = confirming;
                setConfirming(null);
                if (action === 'push') {
                  void execute(
                    'Push',
                    (targetProjectId) => pushGitBranch(targetProjectId, workbench.branch),
                    refreshGit,
                  );
                } else if (action === 'create-pr') {
                  void execute(
                    'Create PR',
                    (targetProjectId) =>
                      createPullRequest(targetProjectId, {
                        title: prTitle.trim(),
                        body: prBody,
                        base: prBase.trim() || undefined,
                        draft: prDraft,
                      }),
                    async () => {
                      setPrTitle('');
                      setPrBody('');
                      setPrBase('');
                      setPrDraft(false);
                      await refreshPullRequests(false);
                    },
                  );
                } else if (action === 'view-pr') {
                  void execute('Open PR', (targetProjectId) =>
                    viewPullRequest(targetProjectId, true),
                  );
                }
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
