import type {
  FileHistoryChangeKind,
  FileHistoryRepository,
  NewFileHistory,
} from '../runtime/repositories.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import { generateId } from '../utils/generate-id.js';

export interface FileSnapshotAdapter {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

interface CapturedFileState {
  path: string;
  existedBefore: boolean;
  backupContent: string | null;
}

interface FileHistoryCapture {
  readonly snapshotId: string;
  readonly threadId: string;
  readonly companyId: string;
  readonly nodeName: string | null;
  readonly employeeId: string | null;
  readonly taskRunId: string | null;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly stepIndex: number | null;
  readonly files: CapturedFileState[];
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))];
}

function parseExplicitPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.includes('/')) return null;
  return value;
}

function collectPaths(value: unknown, sink: string[]): void {
  const parsed = parseExplicitPath(value);
  if (parsed) {
    sink.push(parsed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, sink);
  }
}

export function extractExplicitFilePaths(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  collectPaths(args.path, paths);
  collectPaths(args.file_path, paths);
  collectPaths(args.filePath, paths);
  collectPaths(args.target_path, paths);
  collectPaths(args.targetPath, paths);
  collectPaths(args.destination, paths);
  collectPaths(args.destinationPath, paths);
  collectPaths(args.paths, paths);
  collectPaths(args.files, paths);
  return uniqueStrings(paths);
}

export class FileHistoryService {
  constructor(
    private readonly repo: FileHistoryRepository,
    private readonly fs: FileSnapshotAdapter,
  ) {}

  async beginToolCapture(params: {
    threadId: string;
    companyId: string;
    call: ToolCallRequest;
  }): Promise<FileHistoryCapture | null> {
    const paths = extractExplicitFilePaths(params.call.arguments);
    if (paths.length === 0) return null;

    const files: CapturedFileState[] = [];
    for (const path of paths) {
      const existedBefore = await this.fs.exists(path);
      files.push({
        path,
        existedBefore,
        backupContent: existedBefore ? await this.fs.readTextFile(path) : null,
      });
    }

    return {
      snapshotId: generateId('fhs'),
      threadId: params.threadId,
      companyId: params.companyId,
      nodeName: params.call.nodeName ?? null,
      employeeId: params.call.employeeId ?? null,
      taskRunId: params.call.taskRunId ?? null,
      toolCallId: params.call.toolCallId,
      toolName: params.call.name,
      stepIndex: typeof params.call.stepIndex === 'number' ? params.call.stepIndex : null,
      files,
    };
  }

  async commitToolCapture(capture: FileHistoryCapture | null): Promise<number> {
    if (!capture) return 0;

    let persisted = 0;
    for (const file of capture.files) {
      const existsNow = await this.fs.exists(file.path);
      const currentContent = existsNow ? await this.fs.readTextFile(file.path) : null;
      if (existsNow === file.existedBefore && currentContent === file.backupContent) {
        continue;
      }
      const row: NewFileHistory = {
        history_id: generateId('fh'),
        snapshot_id: capture.snapshotId,
        thread_id: capture.threadId,
        company_id: capture.companyId,
        node_name: capture.nodeName,
        employee_id: capture.employeeId,
        task_run_id: capture.taskRunId,
        tool_call_id: capture.toolCallId,
        tool_name: capture.toolName,
        step_index: capture.stepIndex,
        file_path: file.path,
        change_kind: this.resolveChangeKind(file.existedBefore, existsNow),
        existed_before: file.existedBefore ? 1 : 0,
        backup_content: file.backupContent,
        created_at: new Date().toISOString(),
      };
      await this.repo.create(row);
      persisted += 1;
    }

    return persisted;
  }

  async restoreThreadToStep(threadId: string, stepIndex: number): Promise<number> {
    const rows = (await this.repo.listByThread(threadId)).filter(
      (row) => row.step_index != null && row.step_index >= stepIndex,
    );
    let restored = 0;
    for (const row of rows) {
      if (row.existed_before === 1) {
        await this.fs.writeTextFile(row.file_path, row.backup_content ?? '');
      } else {
        if (await this.fs.exists(row.file_path)) {
          await this.fs.remove(row.file_path);
        }
      }
      restored += 1;
    }
    return restored;
  }

  private resolveChangeKind(existedBefore: boolean, existsNow: boolean): FileHistoryChangeKind {
    if (!existedBefore && existsNow) return 'create';
    if (existedBefore && !existsNow) return 'delete';
    return 'update';
  }
}

export class FileHistoryToolExecutor implements ToolExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly fileHistoryService: FileHistoryService,
    private readonly scope: {
      threadId: string;
      companyId: string;
    },
  ) {}

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    const capture = await this.fileHistoryService.beginToolCapture({
      threadId: this.scope.threadId,
      companyId: this.scope.companyId,
      call,
    });
    try {
      return await this.inner.execute(call);
    } finally {
      await this.fileHistoryService.commitToolCapture(capture);
    }
  }

  async listAvailable(companyId: string) {
    return this.inner.listAvailable(companyId);
  }
}
