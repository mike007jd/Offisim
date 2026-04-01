export type {
  BuiltinTool,
  BuiltinToolConfig,
  ShellExec,
  ShellExecResult,
  ShellExecOptions,
  FsAdapter,
  WebSearchFn,
} from './types.js';
export { createBashTool } from './bash-tool.js';
export { createFileReadTool } from './file-read-tool.js';
export { createFileWriteTool } from './file-write-tool.js';
export { createWebSearchTool } from './web-search-tool.js';

import { createBashTool } from './bash-tool.js';
import { createFileReadTool } from './file-read-tool.js';
import { createFileWriteTool } from './file-write-tool.js';
import type { BuiltinTool, BuiltinToolConfig } from './types.js';
import { createWebSearchTool } from './web-search-tool.js';

/** Create all available built-in tools based on configuration. */
export function createBuiltinTools(config: BuiltinToolConfig): Map<string, BuiltinTool> {
  const tools = new Map<string, BuiltinTool>();

  const bash = createBashTool(config);
  if (bash) tools.set(bash.def.name, bash);

  const fileRead = createFileReadTool(config);
  if (fileRead) tools.set(fileRead.def.name, fileRead);

  const fileWrite = createFileWriteTool(config);
  if (fileWrite) tools.set(fileWrite.def.name, fileWrite);

  // Web search always available (uses DI searchFn or default DuckDuckGo)
  const webSearch = createWebSearchTool(config.webSearch);
  tools.set(webSearch.def.name, webSearch);

  return tools;
}
