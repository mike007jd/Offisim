import type { EventBus } from '../events/event-bus.js';
import type {
  CompanyRepository,
  FileHistoryRepository,
  NodeSummaryRepository,
} from '../runtime/repositories.js';

export interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type GitExec = (
  args: string[],
  cwd: string,
) => Promise<GitExecResult>;

export interface GitAutoCommitResult {
  committed: boolean;
  commitMessage?: string;
  fileCount?: number;
  error?: string;
}

interface GitAutoCommitDeps {
  companies: CompanyRepository;
  fileHistory: FileHistoryRepository;
  nodeSummaries: NodeSummaryRepository;
}

/**
 * Auto-commits file changes after each plan step completes.
 * Desktop-only: requires a gitExec bridge (Tauri command or node:child_process).
 * Browser: inject a no-op gitExec; the service will skip commits gracefully.
 */
export class GitAutoCommitService {
  constructor(
    private readonly repos: GitAutoCommitDeps,
    private readonly eventBus: EventBus,
    private readonly gitExec: GitExec,
  ) {}

  async commitStepChanges(
    threadId: string,
    companyId: string,
    stepIndex: number,
  ): Promise<GitAutoCommitResult> {
    // 1. Get workspace root from company
    const company = await this.repos.companies.findById(companyId);
    if (!company?.workspace_root) {
      return { committed: false, error: 'No workspace root configured' };
    }
    const cwd = company.workspace_root;

    // 2. Check if it's a git repo
    const revParse = await this.gitExec(['rev-parse', '--is-inside-work-tree'], cwd);
    if (!revParse.ok) {
      return { committed: false, error: 'Not a git repository' };
    }

    // 3+4. Fetch file history and node summaries in parallel
    const [allHistory, summaries] = await Promise.all([
      this.repos.fileHistory.listByThread(threadId, { limit: 500 }),
      this.repos.nodeSummaries.listByThread(threadId, { limit: 50 }),
    ]);

    const stepFiles = [
      ...new Set(
        allHistory
          .filter((h) => h.step_index === stepIndex)
          .map((h) => h.file_path),
      ),
    ];

    if (stepFiles.length === 0) {
      return { committed: false, error: 'No file changes in this step' };
    }

    const stepSummary = summaries.find((s) => s.step_index === stepIndex);
    const summaryText = stepSummary?.summary_text ?? `Step ${stepIndex + 1} completed`;

    // 5. Build commit message (use paths relative to workspace root)
    const relPath = (p: string) =>
      p.startsWith(cwd) ? p.slice(cwd.length).replace(/^[/\\]/, '') : p;
    const relFiles = stepFiles.map(relPath);
    const fileList = relFiles.length <= 5
      ? relFiles.join(', ')
      : `${relFiles.slice(0, 4).join(', ')} +${relFiles.length - 4} more`;
    const commitMessage = `[Offisim] ${summaryText}\n\nFiles: ${fileList}\nThread: ${threadId}`;

    // 6. Stage changed files
    const addResult = await this.gitExec(['add', ...stepFiles], cwd);
    if (!addResult.ok) {
      return { committed: false, error: `git add failed: ${addResult.stderr}` };
    }

    // 7. Check if there's actually anything staged
    const statusResult = await this.gitExec(['status', '--porcelain'], cwd);
    if (!statusResult.ok || !statusResult.stdout.trim()) {
      return { committed: false, error: 'Nothing to commit after staging' };
    }

    // 8. Commit
    const commitResult = await this.gitExec(['commit', '-m', commitMessage], cwd);
    if (!commitResult.ok) {
      return { committed: false, error: `git commit failed: ${commitResult.stderr}` };
    }

    // 9. Emit event for UI
    this.eventBus.emit({
      type: 'git.auto.committed',
      entityId: threadId,
      entityType: 'company',
      companyId,
      threadId,
      timestamp: Date.now(),
      payload: {
        stepIndex,
        fileCount: stepFiles.length,
        commitMessage: summaryText,
      },
    });

    return {
      committed: true,
      commitMessage: summaryText,
      fileCount: stepFiles.length,
    };
  }
}
