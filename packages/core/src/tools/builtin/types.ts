import type { ToolDef } from '../../llm/gateway.js';

export interface ShellExecOptions {
  cwd?: string;
  threadId?: string;
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
}

export type ShellExec = (command: string, options: ShellExecOptions) => Promise<ShellExecResult>;

export interface BuiltinTool {
  readonly def: ToolDef;
  execute(args: Record<string, unknown>, context?: { threadId?: string }): Promise<unknown>;
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
}
