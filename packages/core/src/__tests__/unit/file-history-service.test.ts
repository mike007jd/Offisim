import { describe, expect, it, vi } from 'vitest';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import type {
  ToolCallRequest,
  ToolCallResponse,
  ToolExecutor,
} from '../../runtime/tool-executor.js';
import {
  FileHistoryService,
  FileHistoryToolExecutor,
  type FileSnapshotAdapter,
} from '../../services/file-history-service.js';

class MemoryFileSnapshotAdapter implements FileSnapshotAdapter {
  private readonly files = new Map<string, string>();

  seed(path: string, content: string): void {
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async readTextFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value == null) throw new Error(`Missing file: ${path}`);
    return value;
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

function createInnerExecutor(
  handler: (call: ToolCallRequest) => Promise<ToolCallResponse>,
): ToolExecutor {
  return {
    execute: vi.fn(handler),
    listAvailable: vi.fn().mockResolvedValue([]),
  };
}

describe('FileHistoryService', () => {
  it('records changed files for explicit path-based tool calls and can restore a rewound step', async () => {
    const repos = createMemoryRepositories();
    const fs = new MemoryFileSnapshotAdapter();
    fs.seed('/workspace/app.ts', 'before');
    const service = new FileHistoryService(repos.fileHistory, fs);
    const inner = createInnerExecutor(async (call) => {
      await fs.writeTextFile(String(call.arguments.path), 'after');
      return { success: true, result: { ok: true } };
    });
    const executor = new FileHistoryToolExecutor(inner, service, {
      threadId: 'thread-1',
      companyId: 'company-1',
    });

    await executor.execute({
      toolCallId: 'tc-1',
      name: 'write_file',
      arguments: { path: '/workspace/app.ts' },
      nodeName: 'employee',
      employeeId: 'emp-1',
      taskRunId: 'tr-1',
      stepIndex: 1,
    });

    await expect(repos.fileHistory.listByThread('thread-1')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_call_id: 'tc-1',
          file_path: '/workspace/app.ts',
          backup_content: 'before',
          step_index: 1,
        }),
      ]),
    );

    await service.restoreThreadToStep('thread-1', 1);
    await expect(fs.readTextFile('/workspace/app.ts')).resolves.toBe('before');
  });

  it('restores files created during a rewound step by deleting them', async () => {
    const repos = createMemoryRepositories();
    const fs = new MemoryFileSnapshotAdapter();
    const service = new FileHistoryService(repos.fileHistory, fs);
    const inner = createInnerExecutor(async (call) => {
      await fs.writeTextFile(String(call.arguments.path), 'new file');
      return { success: true, result: { ok: true } };
    });
    const executor = new FileHistoryToolExecutor(inner, service, {
      threadId: 'thread-1',
      companyId: 'company-1',
    });

    await executor.execute({
      toolCallId: 'tc-2',
      name: 'write_file',
      arguments: { path: '/workspace/new.ts' },
      nodeName: 'employee',
      employeeId: 'emp-1',
      taskRunId: 'tr-2',
      stepIndex: 2,
    });

    expect(await fs.exists('/workspace/new.ts')).toBe(true);
    await service.restoreThreadToStep('thread-1', 2);
    await expect(fs.exists('/workspace/new.ts')).resolves.toBe(false);
  });
});
