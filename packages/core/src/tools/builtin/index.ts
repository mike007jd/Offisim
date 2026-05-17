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
export { createEditFileTool } from './edit-file-tool.js';
export { createReadAttachmentTool } from './read-attachment-tool.js';
export { createGlobTool, createGrepTool } from './search-tools.js';
export { createWebFetchTool } from './web-fetch-tool.js';
export { createWebSearchTool } from './web-search-tool.js';

import { createBashTool } from './bash-tool.js';
import { createEditFileTool } from './edit-file-tool.js';
import { createFileReadTool } from './file-read-tool.js';
import { createFileWriteTool } from './file-write-tool.js';
import { createReadAttachmentTool } from './read-attachment-tool.js';
import { createGlobTool, createGrepTool } from './search-tools.js';
import type { BuiltinTool, BuiltinToolConfig } from './types.js';
import { createWebFetchTool } from './web-fetch-tool.js';
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

  const editFile = createEditFileTool(config);
  if (editFile) tools.set(editFile.def.name, editFile);

  const glob = createGlobTool(config);
  if (glob) tools.set(glob.def.name, glob);

  const grep = createGrepTool(config);
  if (grep) tools.set(grep.def.name, grep);

  // Web search always available (uses DI searchFn or default DuckDuckGo)
  const webSearch = createWebSearchTool(config.webSearch);
  tools.set(webSearch.def.name, webSearch);
  tools.set('web_fetch', createWebFetchTool());

  if (config.attachmentStoreBridge) {
    const readAttachment = createReadAttachmentTool(config.attachmentStoreBridge, config.eventBus, {
      companyId: config.companyId,
    });
    tools.set(readAttachment.def.name, readAttachment);
  }

  return tools;
}
