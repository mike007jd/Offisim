import type { RunScope } from '@offisim/shared-types';
import type { EventBus } from '../../events/event-bus.js';
import type { ToolDef } from '../../llm/gateway.js';
import type { AttachmentStoreBridge } from '../../runtime/attachment-store-bridge.js';

export interface ShellExecOptions {
  cwd?: string;
  threadId?: string;
  employeeId?: string;
  /**
   * Active project whose bound `workspace_root` scopes the shell sandbox. The
   * desktop `bash_execute` command requires it; a null/absent project means no
   * bound workspace and the executor must fail closed.
   */
  projectId?: string | null;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ShellExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface FsAdapter {
  readFile(path: string, options?: { threadId?: string }): Promise<string>;
  writeFile(path: string, content: string, options?: { threadId?: string }): Promise<void>;
  exists(path: string, options?: { threadId?: string }): Promise<boolean>;
  listDir?(
    path: string,
    options?: { threadId?: string },
  ): Promise<ReadonlyArray<{ name: string; path: string; isFile: boolean; isDirectory: boolean }>>;
}

export type ShellExec = (command: string, options: ShellExecOptions) => Promise<ShellExecResult>;

export interface BuiltinTool {
  readonly def: ToolDef;
  execute(args: Record<string, unknown>, context?: BuiltinToolExecutionContext): Promise<unknown>;
}

export interface BuiltinToolExecutionContext {
  readonly companyId?: string;
  readonly threadId?: string;
  readonly employeeId?: string;
  /** Active project for workspace-scoped tools (carried to `bash`). */
  readonly projectId?: string | null;
  readonly runScope?: RunScope | null;
}

export type WebSearchFn = (query: string) => Promise<string>;

export interface BuiltinToolConfig {
  /** desktop-trusted: full access. browser-limited: bash/file tools disabled. */
  executionMode: 'desktop-trusted' | 'browser-limited';
  /** Shell command executor (DI for Tauri/test/browser) */
  shellExec?: ShellExec;
  /** File system adapter (DI for Tauri/test/browser) */
  fs?: FsAdapter;
  /** Web search function (DI — swap DuckDuckGo for Brave/SerpAPI/etc.) */
  webSearch?: WebSearchFn;
  /** Bash timeout in ms (default 30000) */
  bashTimeoutMs?: number;
  /** Max output bytes (default 100KB) */
  maxOutputBytes?: number;
  /** Fail-closed read-only mode for shell/file mutation tools. */
  readOnly?: boolean;
  /**
   * Optional attachment-store bridge. When supplied AND
   * `runtimeCtx.llmToolCallsEnabled !== false`, `createBuiltinTools` registers
   * the gateway-lane `read_attachment` tool.
   */
  attachmentStoreBridge?: AttachmentStoreBridge;
  /** Runtime company scope for built-ins that must fail closed on tenant boundaries. */
  companyId?: string;
  /** Optional event bus for tools that emit telemetry (`read_attachment`). */
  eventBus?: EventBus;
}

export function isBuiltinToolReadOnly(
  config: Pick<BuiltinToolConfig, 'readOnly'>,
  context?: BuiltinToolExecutionContext,
): boolean {
  return config.readOnly === true || context?.runScope?.toolPolicy?.readOnly === true;
}
