import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inferMcpGrantRiskClass,
  inferMcpGrantRiskSource,
} from '../apps/desktop/renderer/src/data/mcp-risk.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromPlatform = createRequire(resolve(ROOT, 'apps/platform/package.json'));
const { createMemoryRepositories } = await import(
  requireFromPlatform.resolve('@offisim/core/dist/browser.js')
);

const readTool = {
  name: 'read_file',
  annotations: { readOnlyHint: true },
};
const writeTool = {
  name: 'write_file',
  annotations: { readOnlyHint: false },
};
const destructiveTool = {
  name: 'remove_file',
  annotations: { destructiveHint: true },
};
const openWorldTool = {
  name: 'search_web',
  annotations: { readOnlyHint: true, openWorldHint: true },
};
const heuristicWriteTool = {
  name: 'update_record',
  annotations: null,
};
const readAnnotatedWriteNameTool = {
  name: 'update_record',
  annotations: { readOnlyHint: true },
};

assert.equal(inferMcpGrantRiskClass(readTool), 'read');
assert.equal(inferMcpGrantRiskClass(writeTool), 'write');
assert.equal(inferMcpGrantRiskClass(destructiveTool), 'destructive');
assert.equal(inferMcpGrantRiskClass(openWorldTool), 'open_world');
assert.equal(inferMcpGrantRiskClass(heuristicWriteTool), 'write');
assert.equal(inferMcpGrantRiskClass(readAnnotatedWriteNameTool), 'write');
assert.equal(inferMcpGrantRiskSource(readTool), 'server_annotation');
assert.equal(inferMcpGrantRiskSource(heuristicWriteTool), 'name_heuristic');
assert.equal(inferMcpGrantRiskSource(readAnnotatedWriteNameTool), 'name_heuristic');

const repo = createMemoryRepositories().mcpToolGrants;
assert.ok(repo, 'memory repositories expose mcpToolGrants');
await repo.create({
  grant_id: 'grant-read',
  company_id: 'co',
  employee_id: 'emp',
  server_name: 'filesystem',
  tool_name: 'read_file',
  scope: 'employee',
  project_id: null,
  risk_class: inferMcpGrantRiskClass(readTool),
  risk_source: inferMcpGrantRiskSource(readTool),
  trusted_server_id: 'server-1',
  granted_by: 'boss',
  created_at: '2026-06-30T00:00:00.000Z',
});
await repo.create({
  grant_id: 'grant-open',
  company_id: 'co',
  employee_id: 'emp',
  server_name: 'browser',
  tool_name: 'search_web',
  scope: 'employee',
  project_id: null,
  risk_class: inferMcpGrantRiskClass(openWorldTool),
  risk_source: 'human_override',
  trusted_server_id: null,
  granted_by: 'boss',
  created_at: '2026-06-30T00:00:01.000Z',
});

const grants = await repo.listByEmployee('co', 'emp');
assert.equal(grants[0]?.risk_class, 'read', 'read grants must not fall back to write');
assert.equal(grants[0]?.risk_source, 'server_annotation');
assert.equal(grants[0]?.trusted_server_id, 'server-1');
assert.equal(grants[1]?.risk_class, 'open_world', 'open-world grants should persist exactly');

const updated = await repo.updateRisk('co', 'emp', 'filesystem', 'read_file', {
  risk_class: 'write',
  risk_source: 'human_override',
  trusted_server_id: 'server-2',
});
assert.equal(updated?.grant_id, 'grant-read', 'risk update must preserve grant identity');
assert.equal(updated?.created_at, '2026-06-30T00:00:00.000Z');
assert.equal(updated?.risk_class, 'write');
assert.equal(updated?.risk_source, 'human_override');
assert.equal(updated?.trusted_server_id, 'server-2');

const employeePersonaSource = readFileSync(
  resolve(ROOT, 'apps/desktop/renderer/src/data/employee-persona.ts'),
  'utf8',
);
assert.match(
  employeePersonaSource,
  /import \{ inferMcpGrantRiskClass \} from '\.\/mcp-risk\.js';/,
  'Pi MCP scope must share the Settings risk inference helper',
);
assert.doesNotMatch(
  employeePersonaSource,
  /function inferMcpRiskClass/,
  'Pi MCP scope must not keep a second risk inference implementation',
);
assert.match(
  employeePersonaSource,
  /write: effectiveRisk !== 'read'/,
  'Pi MCP scope must derive write-class behavior from persisted risk_class',
);

const detailPaneSource = readFileSync(
  resolve(ROOT, 'apps/desktop/renderer/src/surfaces/settings/McpServerDetailPane.tsx'),
  'utf8',
);
assert.match(
  detailPaneSource,
  /trustedServerId: server\.id/,
  'Settings grant path must persist the trusted server id',
);
assert.match(
  detailPaneSource,
  /riskClass === suggestedRisk \? inferMcpGrantRiskSource\(tool\) : 'human_override'/,
  'Settings grant path must persist server_annotation or name_heuristic unless user overrides',
);
assert.match(
  detailPaneSource,
  /updateMcpToolGrantRisk/,
  'Settings must persist risk changes for existing grants',
);
assert.match(
  detailPaneSource,
  /grantRiskStateKey\(server\.name, employeeId, tool\.name\)/,
  'Settings risk override state must be scoped by employee, server, and tool',
);

console.log('✓ mcp-grant-risk-class: inference and persisted grant risk checks passed');
