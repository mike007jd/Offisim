import type { McpToolGrantRow } from '@offisim/core/browser';

export interface McpRiskTool {
  name: string;
  category?: unknown;
  annotations?: {
    readOnlyHint?: unknown;
    destructiveHint?: unknown;
    openWorldHint?: unknown;
  } | null;
}

const WRITE_TOOL_NAME_RE =
  /(^|_)(write|delete|remove|move|copy|create|edit|update|append|mkdir|touch)(_|$)/i;

export function inferMcpGrantRiskClass(tool: McpRiskTool): McpToolGrantRow['risk_class'] {
  const annotations = tool.annotations ?? {};
  if (annotations.destructiveHint === true) return 'destructive';
  if (annotations.openWorldHint === true) return 'open_world';
  if (tool.category === 'computer-use') return 'write';
  if (annotations.readOnlyHint === false) return 'write';
  return WRITE_TOOL_NAME_RE.test(tool.name) ? 'write' : 'read';
}

export function inferMcpGrantRiskSource(tool: McpRiskTool): McpToolGrantRow['risk_source'] {
  const annotations = tool.annotations ?? {};
  if (annotations.destructiveHint === true || annotations.openWorldHint === true) {
    return 'server_annotation';
  }
  if (tool.category === 'computer-use') return 'server_annotation';
  if (annotations.readOnlyHint === false) return 'server_annotation';
  if (annotations.readOnlyHint === true && !WRITE_TOOL_NAME_RE.test(tool.name)) {
    return 'server_annotation';
  }
  return 'name_heuristic';
}
