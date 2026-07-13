import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
import {
  inferMcpGrantRiskClass,
  inferMcpGrantRiskSource,
} from '../apps/desktop/renderer/src/data/mcp-risk.js';
import type { TauriDrizzleDb } from '../apps/desktop/renderer/src/lib/tauri-drizzle.js';
import { createMcpToolGrantsTauriRepos } from '../apps/desktop/renderer/src/lib/tauri-repos/mcp-tool-grants.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromPlatform = createRequire(resolve(ROOT, 'apps/platform/package.json'));
const { createMemoryRepositories } = await import(
  requireFromPlatform.resolve('@offisim/core/dist/browser.js')
);

function makeProxyDb(sqlite: Database.Database): TauriDrizzleDb {
  const proxy = drizzleProxy(async (sql, params, method) => {
    const bind = params as ReadonlyArray<string | number | null>;
    if (method === 'run') {
      sqlite.prepare(sql).run(...bind);
      return { rows: [] };
    }
    const rows = sqlite
      .prepare(sql)
      .raw()
      .all(...bind) as unknown[][];
    if (method === 'get') return { rows: rows[0] ?? [] };
    return { rows };
  });
  return proxy as unknown as TauriDrizzleDb;
}

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
const computerUseReadAnnotatedTool = {
  name: 'screenshot',
  category: 'computer-use',
  annotations: { readOnlyHint: true },
};

assert.equal(inferMcpGrantRiskClass(readTool), 'read');
assert.equal(inferMcpGrantRiskClass(writeTool), 'write');
assert.equal(inferMcpGrantRiskClass(destructiveTool), 'destructive');
assert.equal(inferMcpGrantRiskClass(openWorldTool), 'open_world');
assert.equal(inferMcpGrantRiskClass(heuristicWriteTool), 'write');
assert.equal(inferMcpGrantRiskClass(readAnnotatedWriteNameTool), 'write');
assert.equal(
  inferMcpGrantRiskClass(computerUseReadAnnotatedTool),
  'write',
  'grant:computer-use-tools-are-write-class',
);
assert.equal(inferMcpGrantRiskSource(readTool), 'server_annotation');
assert.equal(inferMcpGrantRiskSource(heuristicWriteTool), 'name_heuristic');
assert.equal(inferMcpGrantRiskSource(readAnnotatedWriteNameTool), 'name_heuristic');
assert.equal(inferMcpGrantRiskSource(computerUseReadAnnotatedTool), 'server_annotation');

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

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(readFileSync(resolve(ROOT, 'packages/db-local/src/schema.sql'), 'utf8'));
const insertCompany = sqlite.prepare(
  'INSERT INTO companies (company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
);
const insertEmployee = sqlite.prepare(
  'INSERT INTO employees (employee_id, company_id, name, role_slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
);
const fixtureTime = '2026-07-13T00:00:00.000Z';
insertCompany.run('company-a', 'Company A', fixtureTime, fixtureTime);
insertCompany.run('company-b', 'Company B', fixtureTime, fixtureTime);
insertEmployee.run('employee-a', 'company-a', 'Employee A', 'engineer', fixtureTime, fixtureTime);
insertEmployee.run('employee-b', 'company-b', 'Employee B', 'engineer', fixtureTime, fixtureTime);

const sqliteRepo = createMcpToolGrantsTauriRepos(makeProxyDb(sqlite)).mcpToolGrants;
await sqliteRepo.create({
  grant_id: 'grant-valid-b',
  company_id: 'company-b',
  employee_id: 'employee-b',
  server_name: 'filesystem',
  tool_name: 'read_file',
  scope: 'employee',
  project_id: null,
  risk_class: 'read',
  risk_source: 'human_override',
  trusted_server_id: 'server-1',
  granted_by: 'boss',
  created_at: fixtureTime,
});
await assert.rejects(
  sqliteRepo.create({
    grant_id: 'grant-cross-company',
    company_id: 'company-b',
    employee_id: 'employee-a',
    server_name: 'filesystem',
    tool_name: 'read_file',
    scope: 'employee',
    project_id: null,
    risk_class: 'read',
    risk_source: 'human_override',
    trusted_server_id: 'server-1',
    granted_by: 'boss',
    created_at: fixtureTime,
  }),
  (error: unknown) => {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error && /FOREIGN KEY constraint failed/.test(cause.message);
  },
  'the real sqlite-proxy repository must reject a stale employee from another company',
);
sqlite.prepare('DELETE FROM employees WHERE employee_id = ?').run('employee-b');
const remainingGrant = sqlite
  .prepare('SELECT count(*) AS count FROM mcp_tool_grants WHERE grant_id = ?')
  .get('grant-valid-b') as { count: number };
assert.equal(remainingGrant.count, 0, 'employee deletion must cascade to its MCP grants');
sqlite.close();

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
  /trustedServerId: scope\.serverId/,
  'Settings grant path must persist the trusted server id',
);
assert.match(
  detailPaneSource,
  /employeeOptions\.some\(\(option\) => option\.value === employeeId\)/,
  'Settings must reject a stale employee selection after a company switch',
);

const settingsDataSource = readFileSync(
  resolve(ROOT, 'apps/desktop/renderer/src/surfaces/settings/settings-data.ts'),
  'utf8',
);
assert.match(
  settingsDataSource,
  /employee\.company_id !== input\.companyId/,
  'the Settings grant boundary must verify employee ownership',
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
  /grantRiskStateKey\(scope\.serverName, scope\.employeeId, tool\.name\)/,
  'Settings risk override state must be scoped by employee, server, and tool',
);

console.log('✓ mcp-grant-risk-class: inference and persisted grant risk checks passed');
