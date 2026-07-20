import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const rustFiles = ['manager.rs', 'protocol.rs', 'stream.rs', 'types.rs'].map((name) =>
  read(`apps/desktop/src-tauri/src/codex_agent_host/${name}`),
);
const agentHostRuntime = read('apps/desktop/src-tauri/src/agent_host_runtime.rs');
const rustHost = [...rustFiles, agentHostRuntime].join('\n');
// Strip every `#[cfg(test)]` item (brace-balanced), not just a tail split:
// agent_host_runtime.rs has a mid-file test module with production code after it.
const stripCfgTest = (source) => {
  let out = '';
  let rest = source;
  for (;;) {
    const marker = rest.indexOf('\n#[cfg(test)]');
    if (marker === -1) return out + rest;
    out += rest.slice(0, marker + 1);
    const braceStart = rest.indexOf('{', marker);
    if (braceStart === -1) return out;
    let depth = 0;
    let end = braceStart;
    while (end < rest.length) {
      const ch = rest[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      end += 1;
    }
    rest = rest.slice(end + 1);
  }
};
const rustProduction = [...rustFiles, agentHostRuntime].map(stripCfgTest).join('\n');
const shared = read('packages/shared-types/src/runtime/ai-account.ts');
const runtime = read('apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts');
const provenance = read('apps/desktop/renderer/src/runtime/execution-provenance.ts');
const settings = read('apps/desktop/renderer/src/surfaces/settings/AiAccountsPane.tsx');
const schema = read('packages/db-local/src/schema.sql');
const rootPackage = json('package.json');
const desktopPackage = json('apps/desktop/package.json');
const tauri = json('apps/desktop/src-tauri/tauri.conf.json');

for (const removed of [
  'apps/desktop/src-tauri/binaries/codex-app-server.manifest.json',
  'scripts/prepare-codex-app-server.mjs',
  'scripts/check-codex-app-server-artifact.mjs',
  'scripts/check-codex-app-server-bundle.mjs',
  'scripts/finalize-codex-app-server-bundle.mjs',
]) {
  assert.equal(existsSync(join(ROOT, removed)), false, `${removed} must stay removed`);
}

assert.equal('build:codex-app-server' in rootPackage.scripts, false);
assert.doesNotMatch(desktopPackage.scripts['build:frontend'], /codex-app-server/u);
assert.equal('externalBin' in tauri.bundle, false);
assert.equal(
  tauri.bundle.resources.some((value) => /third-party\/codex/u.test(value)),
  false,
);

for (const forbidden of [
  'account/read',
  'model/list',
  'account/rateLimits/read',
  'account/usage/read',
  'subscription_usage',
  'CODEX_MODEL_SOURCE_URL',
  'CodexNativeUsageProjection',
]) {
  assert.doesNotMatch(rustProduction, new RegExp(forbidden.replace('/', '\\/'), 'u'));
}
assert.match(rustProduction, /app-server/u);
assert.match(rustProduction, /--stdio/u);
assert.match(rustProduction, /login[\s\S]{0,160}status/u);
assert.match(rustProduction, /--version/u);
assert.match(rustProduction, /command -v codex/u);
assert.match(rustProduction, /\.args\(\["-lic"/u);
assert.match(rustProduction, /not-installed|not_installed/u);
assert.match(rustProduction, /not-signed-in|not_signed_in/u);
assert.match(rustProduction, /codex:local/u);
assert.match(rustProduction, /engine-managed/u);
assert.match(rustProduction, /source_url:\s*Option<String>/u);
assert.match(rustProduction, /checked_at:\s*Option<String>/u);
assert.match(rustProduction, /subscription-run-diagnostic/u);
assert.match(rustProduction, /input\.saturating_sub\(cache_read\)/u);
assert.match(rustProduction, /"kind": "adapter"/u);
assert.match(rustProduction, /Subscription-included orchestration task; no API cost/u);

for (const field of [
  'RuntimeEngineCapabilityManifest',
  'OrchestrationEngineStatus',
  'orchestrationEngines',
  'permissionModes',
  'processEvents',
  'userInput',
  'fileChanges',
]) {
  assert.match(
    shared + runtime,
    new RegExp(field, 'u'),
    `missing capability/status field ${field}`,
  );
}
assert.match(shared, /kind:\s*'native'/u);
assert.match(provenance, /kind\s*===\s*'native'/u);
assert.match(provenance, /sourceUrl.*undefined|!\('sourceUrl' in value\)/su);
assert.match(schema, /modelSource\.kind'[\s\S]*native/u);
assert.match(schema, /modelSource\.sourceUrl'[\s\S]*(?:IS NULL|is null)/u);

const gatewayStart = runtime.indexOf('class DesktopAgentRuntimeGateway');
const answerStart = runtime.indexOf('  async answerUiRequest(', gatewayStart);
const answerEnd = runtime.indexOf('\n  async reattachLiveRuns(', answerStart);
assert.ok(gatewayStart >= 0 && answerStart > gatewayStart && answerEnd > answerStart);
const answerBody = runtime.slice(answerStart, answerEnd);
assert.match(answerBody, /findById\(answer\.runId\)/u);
assert.match(answerBody, /context\?\.requestId !== answer\.requestId/u);
assert.match(answerBody, /executionTarget\?\.engineId/u);
assert.match(answerBody, /this\.adapter\(engineId\)\.answerUiRequest\(answer\)/u);
assert.doesNotMatch(answerBody, /adapters\.size/u);

assert.match(settings, /API engines?/iu);
assert.match(settings, /Subscription tools?/iu);
assert.match(settings, /engine\.loginCommand/u);
assert.match(settings, /No API cost|无 API 成本/iu);
assert.match(settings, /docsUrl|developers\.openai\.com\/codex\/auth/u);
assert.doesNotMatch(
  settings,
  /Native subscription usage|Rate-limit reset credits|Lifetime activity/u,
);

for (const retained of [
  'turn/interrupt',
  'thread/backgroundTerminals/clean',
  'thread/start',
  'thread/resume',
  'item/reasoning/summaryTextDelta',
  'commandExecution',
  'fileChange',
  'requestUserInput',
]) {
  assert.match(rustHost, new RegExp(retained.replace('/', '\\/'), 'u'), `missing ${retained}`);
}
assert.match(rustHost, /native-agent-home-redacted/u);
assert.match(rustHost, /Bearer\\s\+|\[secret-redacted\]/u);
assert.match(rustHost, /Self::Interrupted\(_\)\s*=>\s*"aborted"/u);

assert.match(rustProduction, /grantRoot/u);
assert.match(rustProduction, /FileChange\s*\{\s*grant_root:/u);
assert.match(rustProduction, /accept\s*&&\s*grant_is_authorized/u);
assert.match(
  rustProduction,
  /path_is_authorized_in_workspace\(grant_root,\s*root,\s*true\)/u,
  'Codex file-change grantRoot must remain inside the effective Project workspace',
);
assert.match(rustProduction, /file_change_changes_are_authorized/u);
assert.match(rustProduction, /file_change_is_authorized\(&item_id\)\s*!=\s*Some\(true\)/u);
assert.match(rustProduction, /respond\(id,\s*json!\(\{"decision":\s*"decline"\}\)\)/u);

console.log('codex orchestration adapter contract OK');
