import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const rootPackage = readJson('package.json');
const desktopPackage = readJson('apps/desktop/package.json');
const tauriConfig = readJson('apps/desktop/src-tauri/tauri.conf.json');
const rustHostSource = readFileSync('apps/desktop/src-tauri/src/pi_agent_host.rs', 'utf8');
const nodeHostSource = readFileSync('scripts/tauri-pi-agent-host.entry.mjs', 'utf8');
const childSupervisorSource = readFileSync('scripts/pi-child-supervisor.mjs', 'utf8');
const wireSource = readFileSync('scripts/pi-agent-host-wire.mjs', 'utf8');
const desktopRuntimeScopeSource = readFileSync(
  'apps/desktop/renderer/src/data/employee-persona.ts',
  'utf8',
);

assert(
  rootPackage.scripts['build:pi-agent-host'] === 'node scripts/build-pi-agent-host.mjs',
  'root package must build the Pi Agent host',
);
assert(!('provider:check' in rootPackage.scripts), 'provider:check must not be a validation gate');
assert(
  rootPackage.scripts.validate.includes('pnpm harness:pi-agent-host'),
  'validate must include the Pi Agent host harness',
);
assert(
  rootPackage.scripts['check:pi-wire-contract'] === 'node scripts/check-pi-wire-contract.mjs',
  'root package must run the Pi Agent wire-contract gate',
);
assert(
  rootPackage.scripts.validate.includes('pnpm check:pi-wire-contract'),
  'validate must include the Pi Agent wire-contract gate',
);
assert(
  desktopPackage.scripts['build:frontend'].includes('build:pi-agent-host'),
  'desktop build must bundle the Pi Agent host',
);
assert(
  !desktopPackage.scripts['build:frontend'].includes('build:claude-agent-host') &&
    !desktopPackage.scripts['build:frontend'].includes('build:codex-agent-host'),
  'desktop build must not bundle Claude/Codex sidecars',
);
assert(
  tauriConfig.bundle.resources.includes('resources/pi-agent-host.mjs'),
  'release bundle must include the Pi Agent host',
);
assert(
  !tauriConfig.bundle.resources.some((resource) => /claude|codex/u.test(resource)),
  'release bundle must not include Claude/Codex sidecar resources',
);
assert(
  /pub struct PiAgentExecuteRequest[\s\S]*mcp_tools: Option<serde_json::Value>/.test(
    rustHostSource,
  ),
  'execute request must deserialize mcpTools so Office runs can receive employee MCP grants',
);
assert(
  /fn sidecar_payload[\s\S]*"mode": "execute"[\s\S]*"mcpTools": req\.mcp_tools/.test(
    rustHostSource,
  ),
  'execute sidecar payload must forward mcpTools to the Node Pi host',
);
assert(
  /const baseTools = toolAllowlistForMode\(permissionMode\)/.test(nodeHostSource) &&
    /const tools = mcpEnabled[\s\S]*\.\.\.\(baseTools \?\? \['read', 'write', 'edit', 'bash'\]\)[\s\S]*'mcp_search_tools'[\s\S]*'mcp_describe_tool'[\s\S]*'mcp_call'/.test(
      nodeHostSource,
    ),
  'execute host must append MCP meta tools to an explicit Pi tool allowlist when mcpTools are scoped',
);
assert(
  /const scopedGrants = grants\.filter/.test(desktopRuntimeScopeSource) &&
    /requestSurface:\s*[\s\S]*server\.requestSurface[\s\S]*: 'settings'/.test(
      desktopRuntimeScopeSource,
    ) &&
    /if \(!server\) \{[\s\S]*continue;[\s\S]*\}/.test(desktopRuntimeScopeSource) &&
    /catch \{[\s\S]*return \[\];[\s\S]*\}/.test(desktopRuntimeScopeSource),
  'desktop buildMcpScope must connect registered MCP servers with their approved surface and expose only ready tools',
);
assert(
  /PI_HOST_PROTOCOL_VERSION = 4/.test(wireSource) &&
    /PI_HOST_PROTOCOL_VERSION: u32 = 4/.test(rustHostSource) &&
    /'worktreeCall'/.test(wireSource) &&
    /WorktreeCall/.test(rustHostSource),
  'F2 must bump the Pi host wire to v4 and decode worktreeCall on both Node and Rust sides',
);
assert(
  /createWorktreeCallChannel/.test(nodeHostSource) &&
    /createWorkspaceLeaseManager/.test(nodeHostSource) &&
    /leaseManager/.test(nodeHostSource) &&
    /now:\s*\(\)\s*=>/.test(nodeHostSource) &&
    /newId:\s*\(\)\s*=>/.test(nodeHostSource) &&
    /confirmIntegration/.test(nodeHostSource),
  'execute host must run the workspace lease manager host-side and gate integration review',
);
assert(
  /handle_worktree_call/.test(rustHostSource) &&
    /run_git_validated/.test(rustHostSource) &&
    /write_worktree_result/.test(rustHostSource),
  'Rust Pi host must intercept worktreeCall and answer with worktreeResult through stdin',
);
assert(
  /finalAssistant\?\.stopReason === 'error'/.test(nodeHostSource) &&
    /normalizePiErrorMessage/.test(nodeHostSource) &&
    /code:\s*'upstream'/.test(nodeHostSource),
  'execute host must surface Pi model error stops as upstream failures instead of empty completed replies',
);
assert(
  /rootModel:\s*model/.test(nodeHostSource) &&
    /const requestedModel = asNonEmptyString\(employee\.model\)/.test(childSupervisorSource) &&
    /: ctx\.rootModel/.test(childSupervisorSource),
  'delegated children must inherit the parent run model unless an employee model override is provided',
);
assert(
  /finalAssistant\?\.stopReason === 'error'/.test(childSupervisorSource) &&
    /Child completed without assistant output/.test(childSupervisorSource),
  'delegated children must fail provider errors and empty outputs instead of reporting completed no-output work',
);

const tempAgentDir = mkdtempSync(join(tmpdir(), 'offisim-pi-agent-host-'));
writeFileSync(
  join(tempAgentDir, 'models.json'),
  `{
    // Pi models.json accepts JSONC comments and trailing commas.
    "providers": {
      "local-test": {
        "baseUrl": "http://127.0.0.1:11434/v1",
        "api": "openai-completions",
        "apiKey": "test",
        "models": [{ "id": "fixture-model" }],
        "modelOverrides": {
          "builtin-model": { "name": "Fixture override" },
        },
      },
    },
  }`,
);

let result;
try {
  const status = spawnSync(process.execPath, ['scripts/tauri-pi-agent-host.entry.mjs'], {
    input: JSON.stringify({ mode: 'status', agentDir: tempAgentDir }),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(status.status === 0, `Pi Agent status host failed: ${status.stderr || status.stdout}`);
  const resultLine = status.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => JSON.parse(line).kind === 'result');
  assert(resultLine, 'Pi Agent status host did not emit a result line');
  result = JSON.parse(resultLine);
  assert(result.response?.ok === true, 'Pi Agent status response must be ok');
  assert(
    Array.isArray(result.response.availableModels),
    'Pi Agent status response must include availableModels from Pi ModelRegistry',
  );
  assert(
    result.response.paths?.modelsPath,
    'Pi Agent status response must expose Pi models.json path',
  );
  assert(
    result.response.modelsConfig?.exists === true &&
      result.response.modelsConfig.providerCount === 1 &&
      result.response.modelsConfig.modelCount === 1 &&
      result.response.modelsConfig.overrideCount === 1 &&
      !result.response.modelsConfig.parseError,
    'Pi Agent status response must expose a safe JSONC models.json configuration summary',
  );
} finally {
  rmSync(tempAgentDir, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      host: 'pi-agent',
      availableModels: result.response.availableModels.length,
      allModelCount: result.response.allModelCount,
      modelsConfig: result.response.modelsConfig,
    },
    null,
    2,
  ),
);
